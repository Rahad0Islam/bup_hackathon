import z from "zod";
import { catchAsync } from "../utils/catchAsync";
import { NextFunction, Request, Response } from "express";
export const validateRequestBody = (schema: z.ZodSchema) => {
	return catchAsync(async (req: Request, res: Response, next: NextFunction) => {
		const payload = req.body ?? {};

		const result = schema.safeParse(payload);

		if (result.success === false) {
			throw new Error(
				result.error.issues.map((issue) => issue.message).join(", "),
			);
		}

		req.body = result.data;
		next();
	});
};
