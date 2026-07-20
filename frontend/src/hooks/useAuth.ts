import { useSelector } from 'react-redux';
import type { RootState } from '@/store/store';


const useAuth = () => useSelector((state: RootState) => state.auth);

export default useAuth;
