import { Router } from "express";
import { UserController } from "./controller.js";

export const userRouter = (controller: UserController): Router => {
    const router = Router();

    router.post('/register', controller.register);
    router.get('/:id', controller.getById);
    router.put('/:id', controller.update);
    router.patch('/deactivate/:id/', controller.deactivate);
    router.delete('/:id', controller.delete);

    return router;
}