import { Request, Response } from 'express';
import { UserError } from './error.js';
import { IUserService } from './service.js';

type Params = { id: string }; // For typing req.params

export class UserController {
    constructor(private readonly userService: IUserService) {}

    register = async (req: Request, res: Response): Promise<void> => {
        try {
            const user = await this.userService.register(req.body);
            res.status(201).json(user);
        } catch (err) {
            if (err instanceof UserError && err.code === 'DUPLICATE_EMAIL') {
                res.status(409).json({ error: err.message }); return;
            }
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    getById = async (req: Request<Params>, res: Response): Promise<void> => {
        try {
            const user = await this.userService.getById(req.params.id);
            res.json(user); 
        } catch (err) {
            if (err instanceof UserError && err.code === 'NOT_FOUND') {
                res.status(404).json({ error: err.message }); return;
            }
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    update = async (req: Request<Params>, res: Response): Promise<void> => {
        try {
            const updated = await this.userService.update(req.params.id, req.body);
            res.json(updated);
        } catch (err) {
            if (err instanceof UserError && err.code === 'NOT_FOUND') {
                res.status(404).json({ error: err.message }); return;
            }
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    deactivate = async (req: Request<Params>, res: Response): Promise<void> => {
        try {
            await this.userService.deactivate(req.params.id);
            res.status(204).send();
        } catch(err) {
            if (err instanceof UserError && err.code === 'NOT_FOUND') {
                res.status(404).json({ error: err.message }); return;
            }
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    activate = async (req: Request<Params>, res: Response): Promise<void> => {
        try {
            await this.userService.activate(req.params.id);
            res.status(204).send();
        } catch(err) {
            if (err instanceof UserError && err.code === 'NOT_FOUND') {
                res.status(404).json({ error: err.message }); return;
            }
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    delete = async (req: Request<Params>, res: Response): Promise<void> => {
        try {
            await this.userService.delete(req.params.id);
            res.status(204).send();
        } catch {
            res.status(500).json({ error: 'Internal server error' });
        }
    };
}