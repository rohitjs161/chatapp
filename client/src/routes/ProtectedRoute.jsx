import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import useAuthStore from "../store/auth.store.js";
import AuthLoadingScreen from "../components/common/AuthLoadingScreen.jsx";

const ProtectedRoute = ({ children }) => {
    const { user, accessToken, isBootstrapping, hasBootstrapped } = useAuthStore();
    const [bootTimeout, setBootTimeout] = useState(false);

    useEffect(() => {
        // If bootstrapping takes more than 10 seconds, show error
        if (!isBootstrapping) return;

        const timer = setTimeout(() => {
            setBootTimeout(true);
        }, 10000);

        return () => clearTimeout(timer);
    }, [isBootstrapping]);

    if (isBootstrapping || !hasBootstrapped) {
        return (
            <AuthLoadingScreen
                title="Opening your chat"
                subtitle="We’re verifying your sign-in before showing your conversations."
                detail={bootTimeout ? "This is taking longer than expected. Please check your connection and try again." : "Your session is being restored securely."}
            />
        );
    }

    if (!user || !accessToken) {
        return <Navigate to="/login" replace />;
    }

    return children;
};

export default ProtectedRoute;