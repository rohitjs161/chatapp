import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/auth.store.js';
import AuthLoadingScreen from '../common/AuthLoadingScreen.jsx';

const MAX_RETRIES = 1;

const OAuthCallback = () => {
    const navigate = useNavigate();
    const { user, accessToken, bootstrapAuth } = useAuthStore();
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (user && accessToken) {
            navigate('/chat', { replace: true });
        }
    }, [accessToken, navigate, user]);

    useEffect(() => {
        let cancelled = false;

        const finalizeGoogleSignIn = async () => {
            if (cancelled) return;

            setAttempt(1);
            const bootstrapSucceeded = await bootstrapAuth(true);

            if (cancelled) return;

            if (bootstrapSucceeded) {
                navigate('/chat', { replace: true });
                return;
            }

            navigate('/login?auth=failed&error=Unable%20to%20complete%20Google%20sign-in.%20Please%20try%20again.', { replace: true });
        };

        finalizeGoogleSignIn();

        return () => {
            cancelled = true;
        };
    }, [bootstrapAuth, navigate]);

    return (
        <AuthLoadingScreen
            title="Completing Google sign-in"
            subtitle={`Checking your session (${attempt}/${MAX_RETRIES})`}
            detail="We’re finishing your login and taking you straight to chat."
        />
    );
};

export default OAuthCallback;
