declare global {
    namespace Express {
        interface Request {
            user?: {
                id: number;
                name: string;
                email: string | null;
                companyId: number;
                role: "ADMIN" | "MANAGER" | "STAFF";
                locationId?: number;
                locationIds?: number[];
            };
        }
    }
}

export { };
