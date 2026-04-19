import { Types } from 'mongoose';

export interface User {
  id:        string;
  name:      string;
  email:     string;
  birthday:  Date;
  timezone:  string;
  active:    boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterUserDTO {
  name:      string;
  email:     string;
  birthday:  Date;
  timezone:  string;
}

export interface UpdateUserDTO {
  name?:     string;
  email?:    string;
  birthday?: Date;
  timezone?: string;
  active?:   boolean;
}