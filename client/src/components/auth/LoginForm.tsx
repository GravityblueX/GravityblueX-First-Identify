'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { LoadingSpinner } from '../ui/LoadingSpinner';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  username: z.string().min(3, 'Username must be at least 3 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type LoginForm = z.infer<typeof loginSchema>;
type RegisterForm = z.infer<typeof registerSchema>;

export function LoginForm() {
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login, register } = useAuth();

  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const registerForm = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      username: '',
      firstName: '',
      lastName: '',
      password: '',
      confirmPassword: '',
    },
  });

  const handleLogin = async (data: LoginForm) => {
    setIsLoading(true);
    setError(null);
    
    try {
      await login(data.email, data.password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (data: RegisterForm) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const { confirmPassword, ...registerData } = data;
      await register(registerData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4 sm:px-6 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full space-y-8"
      >
        <div>
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-blue-600">
            <span className="text-white font-bold text-xl">T</span>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            {isLogin ? 'Sign in to TeamSync' : 'Create your account'}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="font-medium text-blue-600 hover:text-blue-500 transition-colors"
            >
              {isLogin ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>

        <motion.form
          key={isLogin ? 'login' : 'register'}
          initial={{ opacity: 0, x: isLogin ? -20 : 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          className="mt-8 space-y-6"
          onSubmit={isLogin ? loginForm.handleSubmit(handleLogin) : registerForm.handleSubmit(handleRegister)}
        >
          <div className="space-y-4">
            {!isLogin && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    {...registerForm.register('firstName')}
                    label="First Name"
                    error={registerForm.formState.errors.firstName?.message}
                    disabled={isLoading}
                  />
                  <Input
                    {...registerForm.register('lastName')}
                    label="Last Name"
                    error={registerForm.formState.errors.lastName?.message}
                    disabled={isLoading}
                  />
                </div>
                <Input
                  {...registerForm.register('username')}
                  label="Username"
                  error={registerForm.formState.errors.username?.message}
                  disabled={isLoading}
                />
              </>
            )}
            
            <Input
              {...(isLogin ? loginForm.register('email') : registerForm.register('email'))}
              type="email"
              label="Email Address"
              error={isLogin ? loginForm.formState.errors.email?.message : registerForm.formState.errors.email?.message}
              disabled={isLoading}
            />
            
            <Input
              {...(isLogin ? loginForm.register('password') : registerForm.register('password'))}
              type="password"
              label="Password"
              error={isLogin ? loginForm.formState.errors.password?.message : registerForm.formState.errors.password?.message}
              disabled={isLoading}
            />
            
            {!isLogin && (
              <Input
                {...registerForm.register('confirmPassword')}
                type="password"
                label="Confirm Password"
                error={registerForm.formState.errors.confirmPassword?.message}
                disabled={isLoading}
              />
            )}
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-red-600 text-sm text-center bg-red-50 p-3 rounded-md"
            >
              {error}
            </motion.div>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? (
              <LoadingSpinner size="sm" />
            ) : (
              isLogin ? 'Sign In' : 'Create Account'
            )}
          </Button>
        </motion.form>
      </motion.div>
    </div>
  );
}