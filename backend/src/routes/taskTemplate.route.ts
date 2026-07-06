import { accountAccess } from '../middlewares/accountAccess.middleware.js';
import { Router } from "express";
import { createTaskTemplate, mapTemplateInventory, editTaskTemplate, deleteTaskTemplate,getTaskTemplatesByLocation, getTaskTemplate } from "../controllers/taskTemplate.controller.js";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/authorize.middleware.js";

const router = Router();


router.post("/", verifyJwt, authorize("ADMIN", "MANAGER"), accountAccess('MANAGE_WORK'), createTaskTemplate);
router.post("/:id/map-inventory", verifyJwt, authorize("ADMIN", "MANAGER"), accountAccess('MANAGE_WORK'), mapTemplateInventory);
router.patch("/:id", verifyJwt, authorize("ADMIN", "MANAGER"), accountAccess('MANAGE_WORK'), editTaskTemplate);
router.delete("/:id", verifyJwt, authorize("ADMIN", "MANAGER"), accountAccess('MANAGE_WORK'), deleteTaskTemplate);
router.get("/location/:locationId", verifyJwt, authorize("ADMIN", "MANAGER"), getTaskTemplatesByLocation);
router.get("/:id", verifyJwt, authorize("ADMIN", "MANAGER"), getTaskTemplate);

export default router;
