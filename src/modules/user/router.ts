import { Router } from "express";
import { UserController } from "./controller.js";
import { idParamValidation, validate, updateSchema, registerSchema } from "./validator.js";

export const userRouter = (controller: UserController): Router => {
    const router = Router();

    router.post('/register', validate(registerSchema), controller.register);
    router.get('/:id', idParamValidation, controller.getById);
    router.put('/:id', idParamValidation, validate(updateSchema), controller.update);
    router.patch('/deactivate/:id/', idParamValidation, controller.deactivate);
    router.delete('/:id', idParamValidation, controller.delete);

    return router;
}