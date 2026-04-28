const rawApiUrl = import.meta.env.VITE_API_URL || "/api/v1";

const getApiOrigin = () => {
  if (rawApiUrl.startsWith("http://") || rawApiUrl.startsWith("https://")) {
    try {
      return new URL(rawApiUrl).origin;
    } catch {
      return window.location.origin;
    }
  }
  return window.location.origin;
};

export const resolveApiAssetUrl = (value?: string | null) => {
  if (!value) return undefined;
  if (/^(https?:)?\/\//i.test(value) || value.startsWith("data:") || value.startsWith("blob:")) {
    return value;
  }

  const normalizedPath = value.startsWith("/") ? value : `/${value}`;
  return `${getApiOrigin()}${normalizedPath}`;
};
