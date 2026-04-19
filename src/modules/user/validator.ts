import Joi from "joi";
import { Request, Response, NextFunction } from "express";
import { RegisterUserDTO, UpdateUserDTO }  from "./model.js";

const validTimezones = Intl.supportedValuesOf("timeZone");
const invalidTimezoneMsg = {
    "any.only": "Timezone value is not a valid IANA timezone"
};

export const registerSchema = Joi.object<RegisterUserDTO>({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  timezone: Joi.string()
    .valid(...validTimezones)
    .required()
    .messages(invalidTimezoneMsg),
  birthday: Joi.date().required(),
});

export const updateSchema = Joi.object<UpdateUserDTO>({
  name: Joi.string(),
  email: Joi.string().email(),
  timezone: Joi.string()
    .valid(...validTimezones)
    .required()
    .messages(invalidTimezoneMsg),
  birthday: Joi.date(),
  active: Joi.boolean(),
}).min(1).unknown(false); // At least one field must be provided, and no unknown fields allowed

export const validate = (schema: Joi.ObjectSchema) =>
    (req: Request, res: Response, next: NextFunction): void => {
        const { error } = schema.validate(req.body);
        if (error) {
            res.status(400).json({ error: error.details[0].message });
            return;
        }
        next();
    }