import { createSlice, type PayloadAction } from '@reduxjs/toolkit';


 type UserRole = 'ADMIN' | 'MANAGER' | 'STAFF';
 export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  companyId: number;
}


interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean
}

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: false
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setUser(state, action: PayloadAction<AuthUser>) {
      state.user = action.payload;
      state.isAuthenticated = true;
      state.isLoading=false;
    },
    clearUser(state) {
      state.user = null;
      state.isAuthenticated = false;
      state.isLoading=false;
    },
    setLoading(state, action) {
  state.isLoading = action.payload;
}
  },
});

export const { setUser, clearUser, setLoading } = authSlice.actions;
export default authSlice.reducer;
