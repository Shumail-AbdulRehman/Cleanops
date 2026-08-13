import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDispatch } from 'react-redux';

import { setUser } from '@/store/slices/authSlice';
import type { AppDispatch } from '@/store/store';
import { login } from './api';


export const useLogin = () => {
  const dispatch = useDispatch<AppDispatch>();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      queryClient.clear();
      queryClient.setQueryData(["currentUser"], user);
      dispatch(setUser(user));
    },
  });
};
