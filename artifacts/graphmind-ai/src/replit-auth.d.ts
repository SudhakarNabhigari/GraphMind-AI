declare module '@workspace/replit-auth-web' {
  export interface BrowserAuthUser {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
  }
  export function useAuth(): {
    user: BrowserAuthUser | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    login: () => void;
    logout: () => void;
  };
}
