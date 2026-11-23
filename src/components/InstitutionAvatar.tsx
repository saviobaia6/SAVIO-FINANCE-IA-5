import React from 'react';
import { BankLogo } from './BankLogo';

interface InstitutionAvatarProps {
  name?: string;
  code?: string;
  logoUrl?: string;
  sigla?: string;
  cor?: string;
  texto?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_PIXELS: Record<NonNullable<InstitutionAvatarProps['size']>, number> = {
  sm: 32,
  md: 38,
  lg: 42,
};

export const InstitutionAvatar: React.FC<InstitutionAvatarProps> = ({
  name = '',
  code,
  logoUrl,
  size = 'md',
  className = '',
}) => {
  return (
    <BankLogo
      bankName={name || 'Banco'}
      bankCode={code}
      logoUrl={logoUrl}
      size={SIZE_PIXELS[size]}
      className={className}
    />
  );
};
