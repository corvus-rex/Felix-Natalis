import { Router } from "express";
import { UserController } from "./controller.js";
import { validate, updateSchema, registerSchema } from "./validator.js";

export const userRouter = (controller: UserController): Router => {
    const router = Router();

    router.post('/register', validate(registerSchema), controller.register);
    router.get('/:id', controller.getById);
    router.put('/:id', validate(updateSchema), controller.update);
    router.patch('/deactivate/:id/', controller.deactivate);
    router.delete('/:id', controller.delete);

    return router;
}