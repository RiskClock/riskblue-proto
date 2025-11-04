/**
 * Maps database/API errors to user-friendly messages
 * Prevents exposure of internal implementation details
 */
export const getUserFriendlyError = (error: any): string => {
  // Handle Supabase/PostgreSQL error codes
  if (error.code) {
    switch (error.code) {
      case '23505': // Unique violation
        return 'This item already exists. Please use a different value.';
      case '23503': // Foreign key violation
        return 'Cannot complete this action due to related data.';
      case '23502': // Not null violation
        return 'Required information is missing. Please fill in all required fields.';
      case 'PGRST116': // No rows returned
        return 'The requested data was not found.';
      case 'PGRST301': // JWT expired
        return 'Your session has expired. Please sign in again.';
      case '22P02': // Invalid input syntax
        return 'Invalid data format. Please check your input.';
      case '42P01': // Undefined table
        return 'A system error occurred. Please try again later.';
      default:
        break;
    }
  }

  // Handle authentication errors
  if (error.message) {
    const msg = error.message.toLowerCase();
    
    if (msg.includes('invalid login credentials') || msg.includes('invalid email or password')) {
      return 'Invalid email or password. Please try again.';
    }
    if (msg.includes('email already registered') || msg.includes('user already registered')) {
      return 'An account with this email already exists. Please sign in instead.';
    }
    if (msg.includes('email not confirmed')) {
      return 'Please verify your email address before signing in.';
    }
    if (msg.includes('password') && msg.includes('weak')) {
      return 'Password is too weak. Please use a stronger password.';
    }
    if (msg.includes('network') || msg.includes('fetch')) {
      return 'Network error. Please check your connection and try again.';
    }
  }

  // Default fallback - safe, generic message
  return 'An unexpected error occurred. Please try again.';
};
