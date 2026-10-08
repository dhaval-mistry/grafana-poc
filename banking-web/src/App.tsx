import { useEffect, useState } from 'react'
import NavigationTelemetry from './observability/NavigationTelemetry'
import { clearObservabilitySession, restoreAuthenticatedSession, startAuthenticatedSession } from './observability/telemetry'

import {
  AppBar,
  Box,
  Button,
  CssBaseline,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from '@mui/material'

import MenuIcon from '@mui/icons-material/Menu'
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet'
import DashboardIcon from '@mui/icons-material/Dashboard'
import AccountBalanceIcon from '@mui/icons-material/AccountBalance'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import PersonIcon from '@mui/icons-material/Person'
import LogoutIcon from '@mui/icons-material/Logout'

import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'

import Dashboard from './pages/Dashboard'
import Accounts from './pages/Accounts'
import Transactions from './pages/Transactions'
import Transfer from './pages/Transfer'
import Profile from './pages/Profile'
import Login from './pages/Login'

const drawerWidth = 240

const menuItems = [
  {
    label: 'Dashboard',
    icon: <DashboardIcon />,
    path: '/',
  },
  {
    label: 'Accounts',
    icon: <AccountBalanceIcon />,
    path: '/accounts',
  },
  {
    label: 'Transactions',
    icon: <ReceiptLongIcon />,
    path: '/transactions',
  },
  {
    label: 'Transfer',
    icon: <SwapHorizIcon />,
    path: '/transfer',
  },
  {
    label: 'Profile',
    icon: <PersonIcon />,
    path: '/profile',
  },
]

type NavigationDrawerProps = {
  onNavigate: () => void
}

function NavigationDrawer({
  onNavigate,
}: NavigationDrawerProps) {
  const location = useLocation()

  return (
    <Box>
      <Toolbar />

      <List sx={{ px: 1 }}>
        {menuItems.map((item) => {
          const isSelected =
            item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path)

          return (
            <ListItemButton
              key={item.label}
              component={Link}
              to={item.path}
              selected={isSelected}
              onClick={onNavigate}
              sx={{
                borderRadius: 2,
                mb: 0.5,
              }}
            >
              <ListItemIcon>
                {item.icon}
              </ListItemIcon>

              <ListItemText primary={item.label} />
            </ListItemButton>
          )
        })}
      </List>
    </Box>
  )
}

type ProtectedRouteProps = {
  isAuthenticated: boolean
}

function ProtectedRoute({
  isAuthenticated,
}: ProtectedRouteProps) {
  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
      />
    )
  }

  return <Outlet />
}

type BankingLayoutProps = {
  onLogout: () => void
}

function BankingLayout({
  onLogout,
}: BankingLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  const navigate = useNavigate()

  function handleLogout() {
    onLogout()
    navigate('/login', {
      replace: true,
    })
  }

  return (
    <Box
      sx={{
        display: 'flex',
        minHeight: '100vh',
        backgroundColor: 'background.default',
      }}
    >
      <CssBaseline />

      <AppBar
        position="fixed"
        sx={{
          zIndex: (theme) =>
            theme.zIndex.drawer + 1,
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            onClick={() =>
              setMobileOpen(true)
            }
            sx={{
              mr: 2,
              display: {
                md: 'none',
              },
            }}
          >
            <MenuIcon />
          </IconButton>

          <AccountBalanceWalletIcon
            sx={{
              mr: 1,
              display: {
                xs: 'none',
                sm: 'block',
              },
            }}
          />

          <Typography
            variant="h6"
            noWrap
            sx={{
              fontWeight: 700,
              fontSize: {
                xs: '1rem',
                sm: '1.25rem',
              },
              flexGrow: 1,
            }}
          >
            Happy Wallet Bank
          </Typography>

          <Button
            color="inherit"
            startIcon={<LogoutIcon />}
            onClick={handleLogout}
            sx={{
              minWidth: {
                xs: 40,
                sm: 'auto',
              },
            }}
          >
            <Box
              component="span"
              sx={{
                display: {
                  xs: 'none',
                  sm: 'inline',
                },
              }}
            >
              Logout
            </Box>
          </Button>
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        sx={{
          width: {
            md: drawerWidth,
          },
          flexShrink: {
            md: 0,
          },
        }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() =>
            setMobileOpen(false)
          }
          ModalProps={{
            keepMounted: true,
          }}
          sx={{
            display: {
              xs: 'block',
              md: 'none',
            },

            '& .MuiDrawer-paper': {
              width: drawerWidth,
            },
          }}
        >
          <NavigationDrawer
            onNavigate={() =>
              setMobileOpen(false)
            }
          />
        </Drawer>

        <Drawer
          variant="permanent"
          open
          sx={{
            display: {
              xs: 'none',
              md: 'block',
            },

            '& .MuiDrawer-paper': {
              width: drawerWidth,
              boxSizing: 'border-box',
            },
          }}
        >
          <NavigationDrawer
            onNavigate={() =>
              setMobileOpen(false)
            }
          />
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,

          width: {
            xs: '100%',
            md: `calc(100% - ${drawerWidth}px)`,
          },

          px: {
            xs: 2,
            sm: 3,
            md: 4,
          },

          py: {
            xs: 2,
            md: 3,
          },

          overflowX: 'hidden',
        }}
      >
        <Toolbar />

        <Outlet />
      </Box>
    </Box>
  )
}

function AppContent() {
  const [authToken, setAuthToken] =
    useState<string | null>(() => {
      const token = sessionStorage.getItem(
        'happy-wallet-token'
      )
      // Restore observability before child pages issue their first API calls.
      restoreAuthenticatedSession(token !== null)
      return token
    })

  const isAuthenticated = authToken !== null

  useEffect(() => {
    // This observes auth state; it never participates in authentication decisions.
    restoreAuthenticatedSession(isAuthenticated)
  }, [isAuthenticated])

  function handleLogin(token: string) {
    sessionStorage.setItem(
      'happy-wallet-token',
      token
    )

    startAuthenticatedSession()
    setAuthToken(token)
  }

  function handleLogout() {
    sessionStorage.removeItem(
      'happy-wallet-token'
    )

    clearObservabilitySession()
    setAuthToken(null)
  }
  

  return (
    <Routes>
      <Route
        path="/login"
        element={
          isAuthenticated ? (
            <Navigate
              to="/"
              replace
            />
          ) : (
            <Login onLogin={handleLogin} />
          )
        }
      />

      <Route
        element={
          <ProtectedRoute
            isAuthenticated={isAuthenticated}
          />
        }
      >
        <Route
          element={
            <BankingLayout
              onLogout={handleLogout}
            />
          }
        >
          <Route
            path="/"
            element={<Dashboard />}
          />

          <Route
            path="/accounts"
            element={<Accounts />}
          />

          <Route
            path="/transactions"
            element={<Transactions />}
          />

          <Route
            path="/transfer"
            element={<Transfer />}
          />

          <Route
            path="/profile"
            element={<Profile />}
          />
        </Route>
      </Route>

      <Route
        path="*"
        element={
          <Navigate
            to={
              isAuthenticated
                ? '/'
                : '/login'
            }
            replace
          />
        }
      />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <NavigationTelemetry />
      <AppContent />
    </BrowserRouter>
  )
}
