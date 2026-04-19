import { Request, Response } from 'express';
import { UserError } from './error.js';
import { IUserService } from './service.js';
import { logger } from '../../infrastructure/logger.js';

type Params = { id: string }; // For typing req.params

export class UserController {
    constructor(private readonly userService: IUserService) {}

    register = async (req: Request, res: Response, next: Function): Promise<void> => {
        try {
            const user = await this.userService.register(req.body);
            res.status(201).json(user);
        } catch (err) {
            next(err);
        }
    };

    getById = async (req: Request<Params>, res: Response, next: Function): Promise<void> => {
        try {
            const user = await this.userService.getById(req.params.id);
            res.json(user); 
        } catch (err) {
            next(err);
        }
    };

    update = async (req: Request<Params>, res: Response, next: Function): Promise<void> => {
        try {
            const updated = await this.userService.update(req.params.id, req.body);
            res.json(updated);
        } catch (err) {
            next(err);
        }
    };

    deactivate = async (req: Request<Params>, res: Response, next: Function): Promise<void> => {
        try {
            await this.userService.deactivate(req.params.id);
            res.status(204).send();
        } catch(err) {
            next(err);
        }
    };

    activate = async (req: Request<Params>, res: Response, next: Function): Promise<void> => {
        try {
            await this.userService.activate(req.params.id);
            res.status(204).send();
        } catch(err) {
            next(err);
        }
    };

    delete = async (req: Request<Params>, res: Response, next: Function): Promise<void> => {
        try {
            await this.userService.delete(req.params.id);
            res.status(204).send();
        } catch (err) {
            next(err);
        }
    };
}