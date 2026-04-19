import Joi from "joi";
import { Request, Response, NextFunction } from "express";
import { RegisterUserDTO, UpdateUserDTO }  from "./model.js";
import { config } from "../../config/index.js";

const validTimezones = Intl.supportedValuesOf("timeZone");
const invalidTimezoneMsg = {
    "any.only": "Timezone value is not a valid IANA timezone"
};

export const createIdSchema = () => {
  if (config.dbType === 'mongodb') {
    return Joi.string().hex().length(24).required();
  }
  // Add other DB types here as needed
  return Joi.string().required();
}

export const idParamSchema = Joi.object({
  id: createIdSchema(),
});

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
    .messages(invalidTimezoneMsg),
  birthday: Joi.date(),
  active: Joi.boolean(),
}).min(1).unknown(false); // At least one field must be provided, and no unknown fields allowed

export const idParamValidation = (req: Request, res: Response, next: NextFunction): void => {
  const { error } = idParamSchema.validate(req.params);
  if (error) {
    res.status(400).json({ error: error.details[0].message });
    return;
  }
  next();
};

export const validate = (schema: Joi.ObjectSchema) =>
    (req: Request, res: Response, next: NextFunction): void => {
        const { error } = schema.validate(req.body);
        if (error) {
            res.status(400).json({ error: error.details[0].message });
            return;
        }
        next();
    }