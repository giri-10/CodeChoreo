enum VIEWS {
    FILES = "FILES",
    CHATS = "CHATS",
    CLIENTS = "CLIENTS",
    RUN = "RUN",
    COPILOT = "COPILOT",
    SETTINGS = "SETTINGS",
    VIDEO = "VIDEO",
}

interface ViewContext {
    activeView: VIEWS
    setActiveView: (activeView: VIEWS) => void
    isSidebarOpen: boolean
    setIsSidebarOpen: (isSidebarOpen: boolean) => void
    viewComponents: { [key in VIEWS]: JSX.Element }
    viewIcons: { [key in VIEWS]: JSX.Element }
}

export { ViewContext, VIEWS }
