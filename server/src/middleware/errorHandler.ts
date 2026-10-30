import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../errors/AppError';

/**
 * Consistent error response shape sent to clients.
 */
interface ErrorResponse {
  success: false;
  error: {
    message: string;
    statusCode: number;
    details?: unknown;
  };
}

/**
 * Global error handler middleware.
 * Handles known error types (AppError, Multer, Prisma, Zod) and
 * returns a consistent JSON error response.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Error:', err.message);

  // ─── AppError (our custom errors) ───────────────────────────────────
  if (err instanceof AppError) {
    const response: ErrorResponse = {
      success: false,
      error: {
        message: err.message,
        statusCode: err.statusCode,
      },
    };

    // Include details for ValidationError
    if ('details' in err) {
      response.error.details = (err as any).details;
    }

    res.status(err.statusCode).json(response);
    return;
  }

  // ─── Multer errors ─────────────────────────────────────────────────
  if (err instanceof multer.MulterError) {
    let message = err.message;
    let statusCode = 400;

    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        message = 'File size exceeds the maximum allowed limit';
        statusCode = 413;
        break;
      case 'LIMIT_FILE_COUNT':
        message = 'Too many files. Maximum 10 files per upload';
        statusCode = 400;
        break;
      case 'LIMIT_UNEXPECTED_FILE':
        message = err.field ?? 'Unexpected file type';
        statusCode = 400;
        break;
    }

    res.status(statusCode).json({
      success: false,
      error: { message, statusCode },
    } satisfies ErrorResponse);
    return;
  }

  // ─── Zod validation errors ────────────────────────────────────────
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));

    res.status(422).json({
      success: false,
      error: {
        message: 'Validation failed',
        statusCode: 422,
        details,
      },
    } satisfies ErrorResponse);
    return;
  }

  // ─── Prisma errors ────────────────────────────────────────────────
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    let message = 'Database error';
    let statusCode = 500;

    switch (err.code) {
      case 'P2002':
        message = 'A record with this value already exists';
        statusCode = 409;
        break;
      case 'P2025':
        message = 'Record not found';
        statusCode = 404;
        break;
      case 'P2003':
        message = 'Related record not found (foreign key constraint)';
        statusCode = 400;
        break;
    }

    res.status(statusCode).json({
      success: false,
      error: { message, statusCode },
    } satisfies ErrorResponse);
    return;
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({
      success: false,
      error: {
        message: 'Invalid data provided to database query',
        statusCode: 400,
      },
    } satisfies ErrorResponse);
    return;
  }

  // ─── Unknown / unhandled errors ───────────────────────────────────
  const statusCode = 500;
  res.status(statusCode).json({
    success: false,
    error: {
      message:
        process.env.NODE_ENV === 'development'
          ? err.message
          : 'Internal server error',
      statusCode,
    },
  } satisfies ErrorResponse);
}
