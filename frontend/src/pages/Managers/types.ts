export interface ManagerLocationRef {
  id: number;
  name: string;
  isActive: boolean;
}

export interface Manager {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string;
  locations: ManagerLocationRef[];
}

export interface CreateManagerInput {
  name: string;
  email: string;
  password: string;
  locationIds: number[];
}

export interface UpdateManagerInput {
  name?: string;
  email?: string;
  password?: string;
  locationIds?: number[];
}

export interface ManagerFormValues {
  name: string;
  email: string;
  password: string;
  locationIds: string[];
}
