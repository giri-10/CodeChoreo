import express, { Response, Request } from "express"
import dotenv from "dotenv"
import http from "http"
import cors from "cors"
import { SocketEvent, SocketId } from "./types/socket"
import { USER_CONNECTION_STATUS, User } from "./types/user"
import { Server } from "socket.io"
import path from "path"

dotenv.config()

const app = express()

app.use(express.json())

app.use(cors())

app.use(express.static(path.join(__dirname, "public"))) // Serve static files

const server = http.createServer(app)
const io = new Server(server, {
	cors: {
		origin: "*",
		methods: ["GET", "POST"],
		credentials: true
	},
	maxHttpBufferSize: 1e8,
	pingTimeout: 60000,
	pingInterval: 25000,
	connectTimeout: 45000,
	transports: ['websocket', 'polling'],
	allowEIO3: true,
	cookie: false
})

// Add error handling for the server
server.on('error', (error) => {
	console.error('Server error:', error);
});

// Add error handling for Socket.IO
io.engine.on("connection_error", (err) => {
	console.error('Socket.IO connection error:', err);
});

let userSocketMap: User[] = []

// Function to get all users in a room
function getUsersInRoom(roomId: string): User[] {
	return userSocketMap.filter((user) => user.roomId == roomId)
}

// Function to get room id by socket id
function getRoomId(socketId: SocketId): string | null {
	const roomId = userSocketMap.find(
		(user) => user.socketId === socketId
	)?.roomId

	if (!roomId) {
		console.error("Room ID is undefined for socket ID:", socketId)
		return null
	}
	return roomId
}

function getUserBySocketId(socketId: SocketId): User | null {
	const user = userSocketMap.find((user) => user.socketId === socketId)
	if (!user) {
		console.error("User not found for socket ID:", socketId)
		return null
	}
	return user
}

interface CallInviteData {
	callId: string;
	fromUserId: string;
	toUserId: string;
	roomId: string;
}

interface CallResponseData {
	callId: string;
	userId: string;
	roomId: string;
}

interface CallEndData {
	callId: string;
	roomId: string;
}

io.on("connection", (socket) => {
	// Handle user actions
	socket.on(SocketEvent.JOIN_REQUEST, ({ roomId, username }) => {
		// Check is username exist in the room
		const isUsernameExist = getUsersInRoom(roomId).filter(
			(u) => u.username === username
		)
		if (isUsernameExist.length > 0) {
			io.to(socket.id).emit(SocketEvent.USERNAME_EXISTS)
			return
		}

		const user = {
			username,
			roomId,
			status: USER_CONNECTION_STATUS.ONLINE,
			cursorPosition: 0,
			typing: false,
			socketId: socket.id,
			currentFile: null,
		}
		userSocketMap.push(user)
		socket.join(roomId)
		socket.broadcast.to(roomId).emit(SocketEvent.USER_JOINED, { user })
		const users = getUsersInRoom(roomId)
		io.to(socket.id).emit(SocketEvent.JOIN_ACCEPTED, { user, users })
	})

	socket.on("disconnecting", () => {
		const user = getUserBySocketId(socket.id)
		if (!user) return
		const roomId = user.roomId
		socket.broadcast
			.to(roomId)
			.emit(SocketEvent.USER_DISCONNECTED, { user })
		userSocketMap = userSocketMap.filter((u) => u.socketId !== socket.id)
		socket.leave(roomId)
	})

	// Handle file actions
	socket.on(
		SocketEvent.SYNC_FILE_STRUCTURE,
		({ fileStructure, openFiles, activeFile, socketId }) => {
			io.to(socketId).emit(SocketEvent.SYNC_FILE_STRUCTURE, {
				fileStructure,
				openFiles,
				activeFile,
			})
		}
	)

	socket.on(
		SocketEvent.DIRECTORY_CREATED,
		({ parentDirId, newDirectory }) => {
			const roomId = getRoomId(socket.id)
			if (!roomId) return
			socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_CREATED, {
				parentDirId,
				newDirectory,
			})
		}
	)

	socket.on(SocketEvent.DIRECTORY_UPDATED, ({ dirId, children }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return
		socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_UPDATED, {
			dirId,
			children,
		})
	})

	socket.on(SocketEvent.DIRECTORY_RENAMED, ({ dirId, newName }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return
		socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_RENAMED, {
			dirId,
			newName,
		})
	})

	socket.on(SocketEvent.DIRECTORY_DELETED, ({ dirId }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return
		socket.broadcast
			.to(roomId)
			.emit(SocketEvent.DIRECTORY_DELETED, { dirId })
	})

	socket.on(SocketEvent.FILE_CREATED, ({ parentDirId, newFile }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return
		socket.broadcast
			.to(roomId)
			.emit(SocketEvent.FILE_CREATED, { parentDirId, newFile })
	})

	socket.on(SocketEvent.FILE_UPDATED, ({ fileId, newContent }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return
		socket.broadcast.to(roomId).emit(SocketEvent.FILE_UPDATED, {
			fileId,
			newContent,
		})
	})

	socket.on(SocketEvent.FILE_RENAMED, ({ fileId, newName }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return
		socket.broadcast.to(roomId).emit(SocketEvent.FILE_RENAMED, {
			fileId,
			newName,
		})
	})

	socket.on(SocketEvent.FILE_DELETED, ({ fileId }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return
		socket.broadcast.to(roomId).emit(SocketEvent.FILE_DELETED, { fileId })
	})

	// Handle user status
	socket.on(SocketEvent.USER_OFFLINE, ({ socketId }) => {
		userSocketMap = userSocketMap.map((user) => {
			if (user.socketId === socketId) {
				return { ...user, status: USER_CONNECTION_STATUS.OFFLINE }
			}
			return user
		})
		const roomId = getRoomId(socketId)
		if (!roomId) return
		socket.broadcast.to(roomId).emit(SocketEvent.USER_OFFLINE, { socketId })
	})

	socket.on(SocketEvent.USER_ONLINE, ({ socketId }) => {
		userSocketMap = userSocketMap.map((user) => {
			if (user.socketId === socketId) {
				return { ...user, status: USER_CONNECTION_STATUS.ONLINE }
			}
			return user
		})
		const roomId = getRoomId(socketId)
		if (!roomId) return
		socket.broadcast.to(roomId).emit(SocketEvent.USER_ONLINE, { socketId })
	})

	// Handle chat actions
	socket.on(SocketEvent.SEND_MESSAGE, ({ message }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return
		socket.broadcast
			.to(roomId)
			.emit(SocketEvent.RECEIVE_MESSAGE, { message })
	})

	// Handle cursor position
	socket.on(SocketEvent.TYPING_START, ({ cursorPosition }) => {
		userSocketMap = userSocketMap.map((user) => {
			if (user.socketId === socket.id) {
				return { ...user, typing: true, cursorPosition }
			}
			return user
		})
		const user = getUserBySocketId(socket.id)
		if (!user) return
		const roomId = user.roomId
		socket.broadcast.to(roomId).emit(SocketEvent.TYPING_START, { user })
	})

	socket.on(SocketEvent.TYPING_PAUSE, () => {
		userSocketMap = userSocketMap.map((user) => {
			if (user.socketId === socket.id) {
				return { ...user, typing: false }
			}
			return user
		})
		const user = getUserBySocketId(socket.id)
		if (!user) return
		const roomId = user.roomId
		socket.broadcast.to(roomId).emit(SocketEvent.TYPING_PAUSE, { user })
	})

	socket.on(SocketEvent.REQUEST_DRAWING, () => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return
		socket.broadcast
			.to(roomId)
			.emit(SocketEvent.REQUEST_DRAWING, { socketId: socket.id })
	})

	socket.on(SocketEvent.SYNC_DRAWING, ({ drawingData, socketId }) => {
		socket.broadcast
			.to(socketId)
			.emit(SocketEvent.SYNC_DRAWING, { drawingData })
	})

	socket.on(SocketEvent.DRAWING_UPDATE, ({ snapshot }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return
		socket.broadcast.to(roomId).emit(SocketEvent.DRAWING_UPDATE, {
			snapshot,
		})
	})

	// Video call events
	socket.on(SocketEvent.VIDEO_JOIN, ({ roomId }) => {
		console.log(`User ${socket.id} joined video call in room ${roomId}`);
		socket.to(roomId).emit(SocketEvent.VIDEO_JOIN, { userId: socket.id });
	});

	socket.on(SocketEvent.VIDEO_LEAVE, ({ roomId }) => {
		console.log(`User ${socket.id} left video call in room ${roomId}`);
		socket.to(roomId).emit(SocketEvent.VIDEO_LEAVE, { userId: socket.id });
	});

	socket.on(SocketEvent.VIDEO_OFFER, ({ offer, userId }) => {
		console.log(`User ${socket.id} sent video offer to ${userId}`);
		io.to(userId).emit(SocketEvent.VIDEO_OFFER, { offer, userId: socket.id });
	});

	socket.on(SocketEvent.VIDEO_ANSWER, ({ answer, userId }) => {
		console.log(`User ${socket.id} sent video answer to ${userId}`);
		io.to(userId).emit(SocketEvent.VIDEO_ANSWER, { answer, userId: socket.id });
	});

	socket.on(SocketEvent.ICE_CANDIDATE, ({ candidate, userId }) => {
		console.log(`User ${socket.id} sent ICE candidate to ${userId}`);
		io.to(userId).emit(SocketEvent.ICE_CANDIDATE, { candidate, userId: socket.id });
	});

	socket.on(SocketEvent.VIDEO_TOGGLE, ({ enabled, roomId }) => {
		console.log(`User ${socket.id} ${enabled ? 'enabled' : 'disabled'} video in room ${roomId}`);
		socket.to(roomId).emit(SocketEvent.VIDEO_TOGGLE, { userId: socket.id, enabled });
	});

	socket.on(SocketEvent.AUDIO_TOGGLE, ({ enabled, roomId }) => {
		console.log(`User ${socket.id} ${enabled ? 'enabled' : 'disabled'} audio in room ${roomId}`);
		socket.to(roomId).emit(SocketEvent.AUDIO_TOGGLE, { userId: socket.id, enabled });
	});

	// Call invitation events
	socket.on(SocketEvent.CALL_INVITE, (data: CallInviteData) => {
		console.log(`User ${socket.id} invited ${data.toUserId} to call ${data.callId} in room ${data.roomId}`);
		io.to(data.toUserId).emit(SocketEvent.CALL_INVITE, { callId: data.callId, fromUserId: data.fromUserId });
	});

	socket.on(SocketEvent.CALL_ACCEPT, (data: CallResponseData) => {
		console.log(`User ${socket.id} accepted call ${data.callId} in room ${data.roomId}`);
		// Notify the caller that the call was accepted
		const room = getUsersInRoom(data.roomId);
		room.forEach(user => {
			if (user.socketId !== socket.id) {
				io.to(user.socketId).emit(SocketEvent.CALL_ACCEPT, { userId: socket.id });
			}
		});
	});

	socket.on(SocketEvent.CALL_DECLINE, (data: CallResponseData) => {
		console.log(`User ${socket.id} declined call ${data.callId} in room ${data.roomId}`);
		// Notify the caller that the call was declined
		const room = getUsersInRoom(data.roomId);
		room.forEach(user => {
			if (user.socketId !== socket.id) {
				io.to(user.socketId).emit(SocketEvent.CALL_DECLINE, { userId: socket.id });
			}
		});
	});

	socket.on(SocketEvent.CALL_ENDED, (data: CallEndData) => {
		console.log(`Call ${data.callId} ended in room ${data.roomId}`);
		// Notify all users in the room that the call has ended
		socket.to(data.roomId).emit(SocketEvent.CALL_ENDED);
	});
})

const PORT = process.env.PORT || 3000

app.get("/", (req: Request, res: Response) => {
	// Send the index.html file
	res.sendFile(path.join(__dirname, "..", "public", "index.html"))
})

server.listen(PORT, () => {
	console.log(`Listening on port ${PORT}`)
})
