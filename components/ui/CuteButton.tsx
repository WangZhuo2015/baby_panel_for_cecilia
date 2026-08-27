import React from 'react';

interface CuteButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

export const CuteButton: React.FC<CuteButtonProps> = ({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  type = 'button',
  className = '',
  ...props
}) => {
  const sizeStyles = {
    sm: 'py-2 px-4 text-sm min-h-[36px]',
    md: 'py-2.5 px-5 text-sm min-h-[44px]',
    lg: 'py-3.5 px-6 text-base min-h-[52px]',
  };

  const variantStyles = {
    primary: 'bg-primary text-white shadow-button hover:bg-primary-dark',
    secondary: 'bg-primary-light text-primary',
    ghost: 'bg-transparent text-primary hover:bg-primary-light',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      {...props}
      className={`btn-press inline-flex items-center justify-center whitespace-nowrap select-none rounded-[20px] font-medium transition-all cursor-pointer
        ${sizeStyles[size]}
        ${variantStyles[variant]}
        ${fullWidth ? 'w-full' : ''}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}
      `}
    >
      {children}
    </button>
  );
};
