
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDispatch } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';

import { setUser, clearUser } from '@/store/slices/authSlice';
import type { AppDispatch } from '@/store/store';
import { signUp } from './api';
import { ONBOARDING_ROUTES, parseOnboardingQuery } from '../Onboarding/onboardingRoutes';







export const useCreateManager = () => {
  const dispatch = useDispatch<AppDispatch>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { search } = useLocation();

  return useMutation({
    mutationFn: signUp,
    onSuccess: (user) => {
      queryClient.clear();
      if (user.sessionEstablished === false) {
        dispatch(clearUser());
        return;
      }
      queryClient.setQueryData(["currentUser"], user);
      dispatch(setUser(user));
      const query = new URLSearchParams(parseOnboardingQuery(search)).toString();
      navigate(`${ONBOARDING_ROUTES.choosePlan}${query ? `?${query}` : ''}`, { replace: true });
    },
  });
};
