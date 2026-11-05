export const validateEmail=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export const validateUsername=v=>/^[a-z0-9_]{3,24}$/.test(v);
export const passwordScore=v=>[v.length>=8,/[A-Z]/.test(v),/[a-z]/.test(v),/\d/.test(v),/[^\w]/.test(v)].filter(Boolean).length;
