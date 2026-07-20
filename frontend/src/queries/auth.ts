import { useMutation, useQueryClient,useQuery } from '@tanstack/react-query';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { logoutApi,getCurrentUser, refreshToken } from '@/api/auth.js';
import { clearUser } from '@/store/slices/authSlice';

import type { AppDispatch } from '@/store/store';
import { isSessionInvalid } from '@/api/client';
import { requiresPasswordChange } from '@/pages/Account/api';


export const useLogout = () => {
  
  const dispatch = useDispatch<AppDispatch>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: logoutApi,
    onSuccess: () => {
      dispatch(clearUser());
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });
};

export const useGetCurrentUser = () => {

  return useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: (failureCount, error) => failureCount < 1 && !isSessionInvalid(error) && !requiresPasswordChange(error),
    retryDelay: 500,
    // An offline browser must reach the retry screen rather than pause forever.
    networkMode: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
};

export const useRefreshToken= ()=> {

  return useMutation({
    mutationFn: refreshToken,
    retry: false,
  });
}
