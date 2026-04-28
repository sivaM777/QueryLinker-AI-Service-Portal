import React from "react";
import { Avatar, type AvatarProps } from "@mui/material";
import { useAuth, type User } from "../services/auth";
import { resolveApiAssetUrl } from "../utils/url";

type UserAvatarProps = {
  size?: number;
  user?: User | null;
  fallbackInitial?: string;
} & Omit<AvatarProps, "src" | "children">;

export const UserAvatar: React.FC<UserAvatarProps> = ({
  size = 32,
  user: propUser,
  fallbackInitial,
  sx,
  ...avatarProps
}) => {
  const { user: authUser } = useAuth();
  const [imageError, setImageError] = React.useState(false);

  const user = propUser ?? authUser;
  const name = user?.name || "";
  const initial = (name && name[0]?.toUpperCase()) || fallbackInitial || "A";

  const src = !imageError && user?.avatar_url ? resolveApiAssetUrl(user.avatar_url) : undefined;

  return (
    <Avatar
      src={src}
      alt={name || "User"}
      sx={{
        width: size,
        height: size,
        ...sx,
      }}
      imgProps={{
        loading: "lazy",
        style: { objectFit: "cover" },
        onError: () => setImageError(true),
      }}
      {...avatarProps}
    >
      {initial}
    </Avatar>
  );
};
