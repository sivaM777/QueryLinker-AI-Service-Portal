import React, { useState } from "react";
import { 
  Box, 
  Card, 
  Typography, 
  Stack, 
  Divider, 
  Chip, 
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Avatar,
  Grid,
  LinearProgress,
  Container,
  useTheme,
  alpha,
  styled,
  Paper,
  Alert,
  Slider,
  IconButton,
} from "@mui/material";
import { Edit, Save, Cancel, Phone, Business, LocationOn, Badge as BadgeIcon, CalendarToday } from "@mui/icons-material";
import { motion } from "framer-motion";
import Cropper from "react-easy-crop";
import getCroppedImg from "../../utils/cropImage";
import { useAuth } from "../../services/auth";
import { api, getApiErrorMessage } from "../../services/api";
import { resolveApiAssetUrl } from "../../utils/url";

const GlassCard = styled(motion(Card))(({ theme }) => ({
  background: 'rgba(255, 255, 255, 0.8)',
  backdropFilter: 'blur(12px)',
  borderRadius: theme.shape.borderRadius * 3,
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
  overflow: 'visible',
}));

const ProfileHeaderBackground = styled(Box)(({ theme }) => ({
  background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
  height: 160,
  borderRadius: `${theme.shape.borderRadius * 3}px ${theme.shape.borderRadius * 3}px 0 0`,
  position: 'relative',
}));

const AvatarWrapper = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: theme.spacing(4),
  left: theme.spacing(4),
  padding: 6,
  background: 'rgba(255, 255, 255, 0.7)',
  backdropFilter: 'blur(10px)',
  borderRadius: theme.shape.borderRadius * 3,
  boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
}));

const InfoItem = ({ icon, label, value }: { icon: React.ReactNode, label: string, value: string }) => {
  const theme = useTheme();
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
      <Box 
        sx={{ 
          mr: 2, 
          p: 1, 
          borderRadius: 2, 
          bgcolor: alpha(theme.palette.primary.main, 0.1),
          color: theme.palette.primary.main 
        }}
      >
        {icon}
      </Box>
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          {label}
        </Typography>
        <Typography variant="body1" fontWeight={500}>
          {value}
        </Typography>
      </Box>
    </Box>
  );
};

export const Profile: React.FC = () => {
  const { user, updateUser } = useAuth();
  const theme = useTheme();
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [displayAvatarUrl, setDisplayAvatarUrl] = useState(resolveApiAssetUrl(user?.avatar_url) || "");
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  React.useEffect(() => {
    setDisplayAvatarUrl(resolveApiAssetUrl(user?.avatar_url) || "");
  }, [user?.avatar_url]);

  const handleAvatarClick = () => {
    if (!displayAvatarUrl) return;
    setPreviewOpen(true);
  };

  const handleEditAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const onCropComplete = (_croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      if (file.size > 5 * 1024 * 1024) {
        setError("File size must be less than 5MB");
        return;
      }
      
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        setImageSrc(reader.result as string);
        setCropDialogOpen(true);
        setZoom(1);
        setRotation(0);
        setCrop({ x: 0, y: 0 });
      });
      reader.readAsDataURL(file);
      
      // Clear input so same file can be selected again
      event.target.value = '';
    }
  };

  const uploadAvatar = async (file: Blob) => {
    const formData = new FormData();
    formData.append("file", file, "avatar.jpg");

    setLoading(true);
    setError("");

    try {
      const response = await api.post("/users/me/avatar", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      
      if (response.data.avatar_url) {
        setDisplayAvatarUrl(resolveApiAssetUrl(response.data.avatar_url) || "");
        updateUser({ avatar_url: response.data.avatar_url });
        setForm(prev => ({ ...prev, avatar_url: response.data.avatar_url }));
        setCropDialogOpen(false);
        setImageSrc(null);
      }
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to upload avatar"));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCroppedImage = async () => {
    try {
      if (imageSrc && croppedAreaPixels) {
        const croppedImage = await getCroppedImg(imageSrc, croppedAreaPixels, rotation);
        if (croppedImage) {
          await uploadAvatar(croppedImage);
        }
      }
    } catch (e) {
      console.error(e);
      setError("Failed to crop image");
    }
  };

  const closeCropDialog = () => {
    setCropDialogOpen(false);
    setImageSrc(null);
    setZoom(1);
    setRotation(0);
  };

  const closePreview = () => {
    setPreviewOpen(false);
  };

  const [form, setForm] = useState({
    name: user?.name || "",
    email: user?.email || "",
    phone: user?.phone || "",
    department: user?.department || "",
    location: user?.location || "",
    bio: user?.bio || "",
    avatar_url: user?.avatar_url || "",
    availability_status: user?.availability_status || "ONLINE",
    max_concurrent_tickets: user?.max_concurrent_tickets || 5,
    certifications: user?.certifications || [],
    hire_date: user?.hire_date || "",
  });

  const handleSave = async () => {
    if (!user) return;
    
    setLoading(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {};
      if (form.name.trim() && form.name.trim() !== user.name) payload.name = form.name.trim();
      if (form.email.trim() && form.email.trim() !== user.email) payload.email = form.email.trim();
      if (form.phone !== (user.phone ?? "")) payload.phone = form.phone || null;
      if (form.department !== (user.department ?? "")) payload.department = form.department || null;
      if (form.location !== (user.location ?? "")) payload.location = form.location || null;
      if (form.bio !== (user.bio ?? "")) payload.bio = form.bio || null;
      if (form.avatar_url !== (user.avatar_url ?? "")) payload.avatar_url = form.avatar_url || null;
      if (form.availability_status !== (user.availability_status ?? "ONLINE")) payload.availability_status = form.availability_status;
      if (form.max_concurrent_tickets !== (user.max_concurrent_tickets ?? 5)) payload.max_concurrent_tickets = form.max_concurrent_tickets;
      if (JSON.stringify(form.certifications) !== JSON.stringify(user.certifications ?? [])) payload.certifications = form.certifications;
      if (form.hire_date !== (user.hire_date ?? "")) payload.hire_date = form.hire_date || null;

      const res = await api.patch(`/users/me`, payload);
      if (res?.data) {
        updateUser(res.data);
      } else {
        updateUser(payload);
      }
      
      setEditing(false);
      setOpen(false);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to update profile"));
    } finally {
      setLoading(false);
    }
  };

  const openEdit = () => {
    setForm({
      name: user?.name || "",
      email: user?.email || "",
      phone: user?.phone || "",
      department: user?.department || "",
      location: user?.location || "",
      bio: user?.bio || "",
      avatar_url: user?.avatar_url || "",
      availability_status: user?.availability_status || "ONLINE",
      max_concurrent_tickets: user?.max_concurrent_tickets || 5,
      certifications: user?.certifications || [],
      hire_date: user?.hire_date || "",
    });
    setEditing(true);
    setOpen(true);
  };

  const closeEdit = () => {
    setEditing(false);
    setOpen(false);
    setError("");
  };

  const getStatusColor = (status?: string | null) => {
    switch (status) {
      case "ONLINE": return "success";
      case "BUSY": return "warning";
      case "ON_BREAK": return "info";
      case "AWAY": return "default";
      default: return "default";
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }} component={motion.div} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 4 }}>
        <Box>
            <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>Profile Settings</Typography>
            <Typography variant="body1" color="text.secondary">Manage your personal information and preferences</Typography>
        </Box>
        <Button 
            variant="contained" 
            startIcon={<Edit />} 
            onClick={openEdit}
            sx={{ 
                borderRadius: 2,
                background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                boxShadow: `0 4px 14px 0 ${alpha(theme.palette.primary.main, 0.3)}`,
                px: 3
            }}
        >
          Edit Profile
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
            {error}
        </Alert>
      )}

      <GlassCard>
        <ProfileHeaderBackground>
          <AvatarWrapper>
            <Stack direction="row" spacing={2} alignItems="center">
              <Avatar
                src={displayAvatarUrl}
                alt={user?.name || "User"}
                sx={{ width: 120, height: 120, border: '4px solid white', cursor: displayAvatarUrl ? 'pointer' : 'default' }}
                onClick={handleAvatarClick}
              />
              <IconButton
                color="default"
                onClick={handleEditAvatarClick}
                sx={{
                  backgroundColor: alpha(theme.palette.common.white, 0.9),
                  boxShadow: `0 4px 12px 0 ${alpha(theme.palette.primary.main, 0.25)}`,
                  '&:hover': {
                    backgroundColor: alpha(theme.palette.common.white, 0.95),
                  },
                }}
              >
                <Edit fontSize="small" color="primary" />
              </IconButton>
            </Stack>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept="image/png, image/jpeg, image/jpg, image/gif, image/webp"
              onChange={handleFileChange}
            />
          </AvatarWrapper>
        </ProfileHeaderBackground>
        
        <Box sx={{ px: 4, pb: 4, pt: 4 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'flex-start' }} spacing={2}>
                <Box>
                    <Typography variant="h4" fontWeight={700} gutterBottom>
                        {user?.name || "User"}
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" gap={1}>
                        <Chip 
                            label={user?.role || "EMPLOYEE"} 
                            color="primary" 
                            size="small" 
                            sx={{ fontWeight: 600, borderRadius: 1 }} 
                        />
                        <Chip 
                            label={user?.availability_status || "OFFLINE"} 
                            color={getStatusColor(user?.availability_status)}
                            size="small" 
                            sx={{ fontWeight: 600, borderRadius: 1 }}
                        />
                         {user?.team_id && (
                            <Chip 
                                icon={<BadgeIcon sx={{ fontSize: '1rem !important' }} />}
                                label={`Team: ${user.team_id}`} 
                                variant="outlined"
                                size="small"
                                sx={{ borderRadius: 1 }}
                            />
                        )}
                    </Stack>
                    <Typography color="text.secondary" sx={{ mt: 1 }}>{user?.email || ""}</Typography>
                </Box>
            </Stack>

            <Divider sx={{ my: 4 }} />

            <Grid container spacing={4}>
                <Grid item xs={12} md={8}>
                    <Typography variant="h6" fontWeight={700} gutterBottom sx={{ mb: 3 }}>
                        Personal Information
                    </Typography>
                    
                    <Grid container spacing={2}>
                        <Grid item xs={12} sm={6}>
                            <InfoItem icon={<Phone fontSize="small" />} label="Phone" value={user?.phone || "Not provided"} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <InfoItem icon={<Business fontSize="small" />} label="Department" value={user?.department || "Not assigned"} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <InfoItem icon={<LocationOn fontSize="small" />} label="Location" value={user?.location || "Not specified"} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <InfoItem 
                                icon={<CalendarToday fontSize="small" />} 
                                label="Hire Date" 
                                value={user?.hire_date ? new Date(user.hire_date).toLocaleDateString() : "Not specified"} 
                            />
                        </Grid>
                    </Grid>

                    {user?.bio && (
                        <Box sx={{ mt: 3 }}>
                            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                                About
                            </Typography>
                            <Paper elevation={0} sx={{ p: 2, bgcolor: alpha(theme.palette.background.default, 0.5), borderRadius: 2 }}>
                                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                                    {user.bio}
                                </Typography>
                            </Paper>
                        </Box>
                    )}
                </Grid>

                <Grid item xs={12} md={4}>
                     {/* Certifications */}
                    <Box sx={{ mb: 4 }}>
                        <Typography variant="h6" fontWeight={700} gutterBottom sx={{ mb: 2 }}>
                            Certifications
                        </Typography>
                        {user?.certifications && user.certifications.length > 0 ? (
                             <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                {user.certifications.map((cert: string, index: number) => (
                                    <Chip 
                                        key={index} 
                                        label={cert} 
                                        size="small" 
                                        variant="outlined" 
                                        sx={{ borderRadius: 2, bgcolor: 'background.paper' }}
                                    />
                                ))}
                             </Stack>
                        ) : (
                            <Typography variant="body2" color="text.secondary">No certifications listed</Typography>
                        )}
                    </Box>

                    {/* Performance Metrics (for agents) */}
                    {user?.role === "AGENT" && (
                    <Box>
                        <Typography variant="h6" fontWeight={700} gutterBottom sx={{ mb: 2 }}>
                        Performance Settings
                        </Typography>
                        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                <Typography variant="body2" fontWeight={500}>Concurrent Tickets</Typography>
                                <Typography variant="body2" fontWeight={700}>{user?.max_concurrent_tickets || 5}</Typography>
                            </Box>
                            <LinearProgress 
                                variant="determinate" 
                                value={Math.min(((user?.max_concurrent_tickets || 5) / 10) * 100, 100)} 
                                sx={{ height: 8, borderRadius: 4 }}
                            />
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                Maximum tickets allowed at once
                            </Typography>
                        </Paper>
                    </Box>
                    )}
                </Grid>
            </Grid>
        </Box>
      </GlassCard>

      <Dialog
        open={previewOpen}
        onClose={closePreview}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            overflow: "hidden",
            backgroundColor: alpha(theme.palette.background.paper, 0.98),
          },
        }}
      >
        <Box
          sx={{
            p: 3,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Avatar
            src={displayAvatarUrl}
            alt={user?.name || "User"}
            sx={{ width: 220, height: 220, border: '4px solid white' }}
          />
        </Box>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog 
        open={open} 
        onClose={closeEdit} 
        fullWidth 
        maxWidth="md"
        PaperProps={{
            sx: {
                borderRadius: 3,
                backdropFilter: 'blur(10px)',
            }
        }}
      >
        <DialogTitle sx={{ borderBottom: `1px solid ${theme.palette.divider}`, pb: 2 }}>
            <Typography variant="h6" fontWeight={700}>Edit Profile</Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3, pt: 1 }}>
            <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                    <TextField
                    label="Name"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    fullWidth
                    disabled={!editing}
                    variant="outlined"
                    />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField
                    label="Email"
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                    fullWidth
                    disabled={!editing}
                    variant="outlined"
                    />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField
                    label="Phone"
                    value={form.phone}
                    onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                    fullWidth
                    variant="outlined"
                    />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField
                    label="Department"
                    value={form.department}
                    onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
                    fullWidth
                    variant="outlined"
                    />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField
                    label="Location"
                    value={form.location}
                    onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                    fullWidth
                    variant="outlined"
                    />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                    <InputLabel>Availability Status</InputLabel>
                    <Select
                        value={form.availability_status}
                        label="Availability Status"
                        onChange={(e) => setForm((p) => ({ ...p, availability_status: e.target.value as any }))}
                    >
                        <MenuItem value="ONLINE">ONLINE</MenuItem>
                        <MenuItem value="BUSY">BUSY</MenuItem>
                        <MenuItem value="OFFLINE">OFFLINE</MenuItem>
                        <MenuItem value="ON_BREAK">ON_BREAK</MenuItem>
                        <MenuItem value="AWAY">AWAY</MenuItem>
                    </Select>
                    </FormControl>
                </Grid>
            </Grid>
            
            <TextField
              label="Bio"
              value={form.bio}
              onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))}
              multiline
              rows={3}
              fullWidth
              variant="outlined"
            />
            
            <TextField
              label="Avatar URL"
              value={form.avatar_url}
              onChange={(e) => setForm((p) => ({ ...p, avatar_url: e.target.value }))}
              fullWidth
              variant="outlined"
              helperText="Link to your profile picture"
            />
            
            <TextField
                label="Hire Date"
                type="date"
                value={form.hire_date}
                onChange={(e) => setForm((p) => ({ ...p, hire_date: e.target.value }))}
                fullWidth
                InputLabelProps={{ shrink: true }}
                variant="outlined"
            />

            <Box sx={{ p: 2, bgcolor: alpha(theme.palette.background.default, 0.5), borderRadius: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Additional Settings</Typography>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                        <TextField
                        label="Max Concurrent Tickets"
                        type="number"
                        value={form.max_concurrent_tickets.toString()}
                        onChange={(e) => setForm((p) => ({ ...p, max_concurrent_tickets: parseInt(e.target.value) || 5 }))}
                        fullWidth
                        size="small"
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                        label="Certifications"
                        value={form.certifications.join(", ")}
                        onChange={(e) => setForm((p) => ({ ...p, certifications: e.target.value.split(",").map(s => s.trim()).filter(s => s) }))}
                        helperText="Separate by commas"
                        fullWidth
                        size="small"
                        />
                    </Grid>
                </Grid>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3, borderTop: `1px solid ${theme.palette.divider}` }}>
          <Button onClick={closeEdit} startIcon={<Cancel />} color="inherit">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            variant="contained"
            startIcon={<Save />}
            disabled={loading || !form.name.trim() || !form.email.trim()}
            sx={{ borderRadius: 2 }}
          >
            {loading ? "Saving..." : "Save Changes"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Crop Dialog */}
      <Dialog
        open={cropDialogOpen}
        onClose={closeCropDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            overflow: 'hidden'
          }
        }}
      >
        <DialogTitle sx={{ borderBottom: `1px solid ${theme.palette.divider}`, pb: 2 }}>
          <Typography variant="h6" fontWeight={700}>Adjust Profile Photo</Typography>
        </DialogTitle>
        <DialogContent sx={{ p: 0, height: 400, position: 'relative', bgcolor: '#333' }}>
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={1}
              onCropChange={setCrop}
              onCropComplete={onCropComplete}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              cropShape="round"
              showGrid={false}
            />
          )}
        </DialogContent>
        <Box sx={{ p: 3, bgcolor: theme.palette.background.paper }}>
           <Typography gutterBottom variant="body2" color="text.secondary">Zoom</Typography>
           <Stack direction="row" spacing={2} alignItems="center">
             <Typography variant="caption">-</Typography>
             <Slider
               value={zoom}
               min={1}
               max={3}
               step={0.1}
               aria-labelledby="Zoom"
               onChange={(_e, zoom) => setZoom(Number(zoom))}
             />
             <Typography variant="caption">+</Typography>
           </Stack>
        </Box>
        <DialogActions sx={{ p: 3, pt: 0, bgcolor: theme.palette.background.paper }}>
          <Button onClick={closeCropDialog} color="inherit" disabled={loading}>
            Cancel
          </Button>
          <Button 
            onClick={handleSaveCroppedImage} 
            variant="contained" 
            disabled={loading}
            startIcon={loading ? null : <Save />}
          >
            {loading ? "Saving..." : "Save Photo"}
          </Button>
        </DialogActions>
      </Dialog>

    </Container>
  );
};
