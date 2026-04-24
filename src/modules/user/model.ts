import { Types } from 'mongoose';

export interface User {
  id:             string;
  name:           string;
  email:          string;
  birthday:       Date;
  nextBirthDayAt: Date;
  timezone:       string;
  active:         boolean;
  createdAt:      Date;
  updatedAt:      Date;
}

export interface RegisterUserDTO {
  name:            string;
  email:           string;
  birthday:        Date;
  timezone:        string;
  nextBirthDayAt:  Date;
}

export interface UpdateUserDTO {
  name?:           string;
  email?:          string;
  birthday?:       Date;
  timezone?:       string;
  active?:         boolean;
  nextBirthDayAt?: Date;
}