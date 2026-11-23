import React, { useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';
import { resolveBankIdentity } from '../domain/extractions/banksRepository';

export interface BankLogoProps {
  bankName: string;
  bankCode?: string;
  logoUrl?: string;
  size?: number;
  className?: string;
}

function renderCatalogMark(catalogId: string | undefined, sigla: string, size: number) {
  const iconSize = Math.max(14, Math.round(size * 0.56));
  const stroke = 'currentColor';

  switch (catalogId) {
    case 'nubank':
      return (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4.5 17V8.2C4.5 6.4 6 5.2 7.5 5.2C9.1 5.2 10.3 6.4 10.3 8.2V17M13.7 17V8.2C13.7 6.4 15 5.2 16.6 5.2C18.2 5.2 19.5 6.4 19.5 8.2V17"
            stroke={stroke}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'inter':
      return (
        <span className="font-display font-black tracking-tighter leading-none" style={{ fontSize: Math.max(10, Math.round(size * 0.34)) }}>
          inter
        </span>
      );
    case 'itau':
      return (
        <span className="font-display font-black tracking-tight leading-none" style={{ fontSize: Math.max(10, Math.round(size * 0.34)) }}>
          itaú
        </span>
      );
    case 'bradesco':
      return (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 17C5 11.8 8.2 8.2 12 8.2C15.8 8.2 19 11.8 19 17" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
          <path d="M8.5 17C8.5 14 10.1 12.2 12 12.2C13.9 12.2 15.5 14 15.5 17" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="12" cy="6.2" r="1.5" fill={stroke} />
        </svg>
      );
    case 'bb':
      return (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3.5L20.5 12L12 20.5L3.5 12L12 3.5Z" stroke={stroke} strokeWidth="2.2" />
          <path d="M7.5 12L12 7.5L16.5 12L12 16.5L7.5 12Z" fill={stroke} />
        </svg>
      );
    case 'caixa':
      return (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6L18 18" stroke="#F59E0B" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M18 6L6 18" stroke={stroke} strokeWidth="3.2" strokeLinecap="round" />
        </svg>
      );
    case 'santander':
      return (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 4.5C12.8 7.3 15.2 8.7 15.2 11.4C15.2 13.4 13.8 14.8 12 14.8C10.2 14.8 8.8 13.4 8.8 11.4C8.8 9.9 9.5 8.7 10.4 7.7" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
          <path d="M5.5 16.5C7 18.2 9.4 19 12 19C14.6 19 17 18.2 18.5 16.5" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );
    case 'sicredi':
    case 'sicoob':
    case 'cresol':
    case 'unicred':
      return (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 4L18.5 12L12 20L5.5 12L12 4Z" stroke={stroke} strokeWidth="2.2" />
          <circle cx="12" cy="12" r="2.2" fill={stroke} />
        </svg>
      );
    case 'cora':
    case 'stone':
    case 'picpay':
    case 'mercadopago':
    case 'pagbank':
    case 'c6bank':
    case 'btgpactual':
    case 'xp':
    case '99pay':
    case 'neon':
    case 'next':
    case 'willbank':
    case 'iti':
    case 'recargapay':
      return (
        <span
          className="font-display font-extrabold tracking-tight leading-none"
          style={{ fontSize: Math.max(10, Math.round(size * 0.35)) }}
        >
          {sigla}
        </span>
      );
    default:
      return null;
  }
}

export function BankLogo({
  bankName,
  bankCode,
  logoUrl,
  size = 40,
  className = '',
}: BankLogoProps) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [logoUrl]);

  const resolved = resolveBankIdentity(bankName, bankCode);
  const showExternalImage = Boolean(logoUrl && logoUrl.trim() && !imgFailed);
  const label = resolved.codigo
    ? `${resolved.nome} (${resolved.codigo})`
    : resolved.nome;

  const catalogMark = resolved.isKnownCatalogBank
    ? renderCatalogMark(resolved.catalogId, resolved.sigla, size)
    : null;

  const radiusClass = size >= 38 ? 'rounded-xl' : 'rounded-lg';

  return (
    <div
      className={`bank-logo relative inline-flex items-center justify-center shrink-0 overflow-hidden select-none border border-black/10 dark:border-white/15 shadow-xs ${radiusClass} ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: showExternalImage
          ? '#FFFFFF'
          : resolved.isKnownCatalogBank
            ? resolved.cor
            : '#0F172A',
        color: resolved.isKnownCatalogBank ? resolved.texto : '#FFFFFF',
      }}
      title={label}
      aria-label={label}
    >
      {showExternalImage ? (
        <img
          src={logoUrl}
          alt={label}
          className="w-full h-full object-contain p-1"
          onError={() => setImgFailed(true)}
        />
      ) : resolved.isKnownCatalogBank ? (
        catalogMark || (
          <span
            className="font-display font-extrabold tracking-tight leading-none"
            style={{ fontSize: Math.max(10, Math.round(size * 0.34)) }}
          >
            {resolved.sigla}
          </span>
        )
      ) : (
        <Landmark
          size={Math.max(15, Math.round(size * 0.5))}
          strokeWidth={1.9}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
