import { useEffect } from "react";

export const useChatEvents = (
    onNewMessage,
    sessionVersion,
    onMessageUpdated
) => {
    useEffect(() => {
        const eventSource = new EventSource("/api/events");

        const handleNewMessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                onNewMessage(data);
            } catch (error) {
                console.error("Invalid SSE event:", error);
            }
        };

        const handleMessageUpdated = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (typeof onMessageUpdated === "function") {
                    onMessageUpdated(data);
                } else if (typeof onNewMessage === "function") {
                    onNewMessage(data);
                }
            } catch (error) {
                console.error("Invalid SSE message_updated event:", error);
            }
        };

        eventSource.addEventListener(
            "new_message",
            handleNewMessage
        );

        eventSource.addEventListener(
            "message_updated",
            handleMessageUpdated
        );

        eventSource.onerror = () => {
            console.warn("SSE connection interrupted");
        };

        return () => {
            eventSource.removeEventListener(
                "new_message",
                handleNewMessage
            );

            eventSource.removeEventListener(
                "message_updated",
                handleMessageUpdated
            );

            eventSource.close();
        };
    }, [onNewMessage, sessionVersion, onMessageUpdated]);
};
