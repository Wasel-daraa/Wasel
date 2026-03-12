import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  Bell, ClipboardList, FileDown, LayoutDashboard, Loader2, LogOut,
  Search, Settings2, ShieldCheck, Truck, Users, MessageCircle,
  Package, Phone, MapPin, User, ChevronDown, ChevronUp,
  Image as ImageIcon, Crown, Link as LinkIcon, RefreshCcw, Trash2, BookOpen,
  Wallet, Plus, Minus, BarChart3, TrendingUp, Calendar, Download, Star, Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { updateUsdToSypRateCache } from '@/lib/exchangeRate';
import { createPageUrl } from '@/utils';
import { notifySpecificUsers, notifyOrderUsers } from '@/services/firebaseOrderNotifications';
import { initializePushNotifications } from '@/services/pushNotifications';
import SmartLottie from '@/components/animations/SmartLottie';
import { ANIMATION_PRESETS } from '@/components/animations/animationPresets';

const ADMIN_ROLES = ['admin', 'super_admin', 'support', 'operator', 'supervisor'];

const STATUS_OPTIONS = ['pending', 'processing', 'delivering', 'completed', 'cancelled'];

const STATUS_LABELS_AR = {
  pending: 'قيد انتظار القبول',
  processing: 'تم القبول ويتم تجهيز طلبك',
  delivering: 'جاري التوصيل',
  completed: 'تم الاستلام',
  cancelled: 'ملغي',
};

function normalizeOrderStatus(status, paymentStatus) {
  const raw = String(status || '').toLowerCase();
  const payment = String(paymentStatus || '').toLowerCase();

  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled';
  if (raw === 'completed' || raw === 'delivered' || raw === 'received') return 'completed';
  if (raw === 'delivering' || raw === 'out_for_delivery') return 'delivering';

  if (
    raw === 'processing'
    || raw === 'in_progress'
    || raw === 'accepted'
    || raw === 'assigned'
    || raw === 'paid'
    || payment === 'paid'
    || payment === 'succeeded'
    || payment === 'completed'
  ) {
    return 'processing';
  }

  return 'pending';
}

const PANEL_SECTIONS = [
  { key: 'overview', label: 'نظرة عامة', icon: LayoutDashboard },
  { key: 'analytics', label: 'تحليلات', icon: BarChart3 },
  { key: 'orders', label: 'الطلبات', icon: ClipboardList },
  { key: 'couriers', label: 'الموصلون', icon: Users },
  { key: 'reviews', label: 'التقييمات', icon: Star },
  { key: 'messages', label: 'الرسائل', icon: MessageCircle },
  { key: 'memberships', label: 'Wasel+', icon: Crown },
  { key: 'wallets', label: 'المحافظ', icon: BookOpen },
  { key: 'user-control', label: 'إدارة المستخدمين', icon: Wallet },
  { key: 'controls', label: 'التحكم', icon: Settings2 },
];

const DEFAULT_EXCHANGE_RATE = 150;

function normalizeDecimalInput(value) {
  const raw = String(value ?? '').replace(',', '.').replace(/[^0-9.]/g, '');
  const parts = raw.split('.');
  if (parts.length <= 1) return raw;
  return `${parts[0]}.${parts.slice(1).join('')}`;
}

function extractOrderItems(order) {
  // 1. Direct items array (JSONB column on orders table, or from order_items DB query)
  if (Array.isArray(order.items) && order.items.length > 0) return order.items;
  // 2. cart_snapshot.items (if column exists)
  const cs = order.cart_snapshot;
  if (cs && Array.isArray(cs.items) && cs.items.length > 0) return cs.items;
  // 3. metadata.items
  const md = order.metadata;
  if (md && Array.isArray(md.items) && md.items.length > 0) return md.items;
  if (md && md.cart_snapshot && Array.isArray(md.cart_snapshot.items) && md.cart_snapshot.items.length > 0) return md.cart_snapshot.items;
  // 4. sender_details.meta.items (RPC embeds meta into sender_details)
  const sd = order.sender_details;
  if (sd && sd.meta && Array.isArray(sd.meta?.items) && sd.meta.items.length > 0) return sd.meta.items;
  // 5. Try parsing items if it's a JSON string
  if (typeof order.items === 'string') {
    try {
      const parsed = JSON.parse(order.items);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) { /* ignore */ }
  }
  return [];
}

function getItemImageUrl(item) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.image_url === 'string' && item.image_url.trim()) return item.image_url;
  if (typeof item.image === 'string' && item.image.startsWith('http')) return item.image;
  if (Array.isArray(item.images) && item.images.length > 0) {
    const img = item.images[0];
    if (typeof img === 'string') return img;
    if (img && typeof img.url === 'string') return img.url;
  }
  return null;
}

function toDateInputValue(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function detectOrderFlowType(order) {
  const meta = order?.sender_details?.meta || {};
  const createdVia = String(meta?.created_via || '').toLowerCase();
  const collaborationMode = String(order?.collaboration_mode || '').toLowerCase();
  const sourceRegion = String(meta?.sourceRegion || meta?.source_region || '').toLowerCase();
  const senderCountry = String(order?.sender_details?.country || '').toLowerCase();

  if (collaborationMode === 'shared' || createdVia === 'shared_cart_link') return 'shared';
  if (sourceRegion === 'inside_syria') return 'inside';
  if (sourceRegion === 'outside_syria') return 'outside';
  if (senderCountry === 'syria' || senderCountry === 'sy') return 'inside';
  return 'outside';
}

function orderFlowLabel(type) {
  if (type === 'shared') return 'مشترك';
  if (type === 'inside') return 'داخل سوريا';
  return 'خارج سوريا';
}

function orderFlowBadgeClass(type) {
  if (type === 'shared') return 'bg-violet-100 text-violet-700';
  if (type === 'inside') return 'bg-sky-100 text-sky-700';
  return 'bg-emerald-100 text-emerald-700';
}

function getSharedCartUrl(order) {
  const senderMeta = order?.sender_details?.meta || {};
  const metadata = order?.metadata || {};
  const directUrl = senderMeta.shared_cart_url || metadata.shared_cart_url || metadata.share_url;
  if (typeof directUrl === 'string' && directUrl.trim()) return directUrl;

  const token = senderMeta.shared_cart_token || metadata.shared_cart_token;
  if (token) return `https://waselstore.com/shared-cart/${token}`;

  return '';
}

export default function SupervisorPanel() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [couriers, setCouriers] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [assigningOrderId, setAssigningOrderId] = useState(null);
  const [selectedCourierByOrder, setSelectedCourierByOrder] = useState({});
  const [updatingStatusForOrder, setUpdatingStatusForOrder] = useState(null);
  const [activeSection, setActiveSection] = useState('orders');
  const [expandedOrderIds, setExpandedOrderIds] = useState(() => new Set());
  const [deliveryTimeByOrder, setDeliveryTimeByOrder] = useState({});
  const [savingDeliveryTime, setSavingDeliveryTime] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [activatingMembership, setActivatingMembership] = useState(null);
  const [savingMembershipId, setSavingMembershipId] = useState(null);
  const [membershipEdits, setMembershipEdits] = useState({});

  const [systemWallets, setSystemWallets] = useState([]);
  const [resettingWalletId, setResettingWalletId] = useState(null);
  const [exchangeRateInput, setExchangeRateInput] = useState(String(DEFAULT_EXCHANGE_RATE));
  const [savingExchangeRate, setSavingExchangeRate] = useState(false);
  const [refreshingDashboard, setRefreshingDashboard] = useState(false);
  const [resettingCourierId, setResettingCourierId] = useState(null);
  const [deletingOrderId, setDeletingOrderId] = useState(null);

  // User Control States
  const [users, setUsers] = useState([]);
  const [usersSearch, setUsersSearch] = useState('');
  const [selectedUserForWallet, setSelectedUserForWallet] = useState(null);
  const [walletAmountToAdd, setWalletAmountToAdd] = useState('');
  const [walletAmountToReduce, setWalletAmountToReduce] = useState('');
  const [updatingUserWallet, setUpdatingUserWallet] = useState(null);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Reviews Section States
  const [reviewsFeedback, setReviewsFeedback] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  // Messages Section States
  const [conversations, setConversations] = useState([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [activeConversation, setActiveConversation] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);

  const toggleOrderDetails = (orderId) => {
    setExpandedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId); else next.add(orderId);
      return next;
    });
  };

  const getExchangeRate = (order) => {
    const rate = Number(order?.exchange_rate);
    return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_EXCHANGE_RATE;
  };

  const getOrderTotalUSD = (order) => {
    const totalUsd = Number(order?.total_usd);
    if (Number.isFinite(totalUsd) && totalUsd > 0) return totalUsd;
    const total = Number(order?.total_amount);
    const currency = String(order?.currency || '').toUpperCase();
    if (Number.isFinite(total) && total >= 0) {
      if (currency === 'SYP') return total / getExchangeRate(order);
      return total;
    }
    const fromCents = Number(order?.total_cents);
    if (Number.isFinite(fromCents)) return fromCents / 100;
    return 0;
  };

  const getOrderTotalSYP = (order) => {
    const total = Number(order?.total_syp);
    if (Number.isFinite(total) && total > 0) return total;
    const amount = Number(order?.total_amount);
    const currency = String(order?.currency || '').toUpperCase();
    if (Number.isFinite(amount) && amount > 0 && currency === 'SYP') return amount;
    const fromUsd = getOrderTotalUSD(order) * getExchangeRate(order);
    if (Number.isFinite(fromUsd) && fromUsd > 0) return fromUsd;
    return 0;
  };

  const getItemQty = (item) => {
    const qty = Number(item?.quantity ?? item?.qty ?? 1);
    return Number.isFinite(qty) && qty > 0 ? qty : 1;
  };

  const getItemUnitUSD = (item) => {
    const direct = Number(item?.unit_price_usd ?? item?.price_usd ?? item?.priceUSD ?? item?.unit_price ?? item?.price);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const total = Number(item?.total_price_usd ?? item?.total_price);
    if (Number.isFinite(total) && total > 0) return total / getItemQty(item);
    const syp = Number(item?.priceSYP ?? item?.price_syp ?? 0);
    if (Number.isFinite(syp) && syp > 0) return syp / DEFAULT_EXCHANGE_RATE;
    return 0;
  };

  const getItemName = (item, idx) => (
    item?.product_name || item?.item_name || item?.name_ar || item?.name || item?.title || `صنف ${idx + 1}`
  );

  const handleDownloadInvoice = async (order) => {
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const orderNumber = order.order_number || order.id;
      const totalUSD = getOrderTotalUSD(order);
      const totalSYP = getOrderTotalSYP(order);
      const exchangeRate = getExchangeRate(order);
      const items = extractOrderItems(order);

      let y = 50;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
      doc.text('WASEL Invoice', 40, y); y += 24;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
      doc.text(`Order: ${orderNumber}`, 40, y); y += 16;
      doc.text(`Date: ${new Date(order.created_at || Date.now()).toLocaleString()}`, 40, y); y += 16;
      doc.text(`Recipient: ${order.recipient_details?.name || '-'}`, 40, y); y += 16;
      doc.text(`Phone: ${order.recipient_details?.phone || '-'}`, 40, y); y += 16;
      doc.text(`Exchange Rate: 1 USD = ${exchangeRate.toLocaleString('en-US')} SYP`, 40, y); y += 24;
      doc.setFont('helvetica', 'bold'); doc.text('Items:', 40, y); y += 14;
      doc.setFont('helvetica', 'normal');

      items.forEach((item, idx) => {
        const qty = getItemQty(item);
        const unitUSD = getItemUnitUSD(item);
        const unitSYP = unitUSD * exchangeRate;
        doc.text(`${idx + 1}. ${getItemName(item, idx)} | Qty: ${qty} | USD ${unitUSD.toFixed(2)} | SYP ${Math.round(unitSYP).toLocaleString('en-US')}`, 40, y);
        y += 14;
        if (y > 760) { doc.addPage(); y = 40; }
      });

      y += 12; doc.setFont('helvetica', 'bold');
      doc.text(`Total USD: ${totalUSD.toFixed(2)}`, 40, y); y += 16;
      doc.text(`Total SYP: ${Math.round(totalSYP).toLocaleString('en-US')}`, 40, y);
      doc.save(`invoice-${orderNumber}.pdf`);
      toast.success('تم تحميل الفاتورة');
    } catch (error) {
      console.error('Invoice download error:', error);
      toast.error('تعذر تحميل الفاتورة');
    }
  };

  const loadDashboardData = async () => {
    const [ordersResult, couriersResult, adminCouriersResult, walletsResult] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('users').select('id, auth_id, full_name, email, role').in('role', ['courier', 'delivery_person']).order('full_name', { ascending: true }),
      supabase.from('admin_users').select('id, name, email, role, is_active').eq('role', 'delivery_person').eq('is_active', true),
      supabase.from('wallets').select('*, user:users(full_name, email)'),
    ]);

    if (ordersResult.error) throw ordersResult.error;
    if (couriersResult.error) throw couriersResult.error;
    if (adminCouriersResult.error) throw adminCouriersResult.error;
    if (walletsResult?.data) setSystemWallets(walletsResult.data);

    const ordersData = Array.isArray(ordersResult.data) ? ordersResult.data : [];
    console.log('📋 Sample order structure:', ordersData[0] ? Object.keys(ordersData[0]) : 'No orders', ordersData[0]);
    const orderIds = ordersData.map((o) => o.id).filter(Boolean);
    let assignmentsByOrderId = {};

    if (orderIds.length > 0) {
      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('order_assignments').select('id, order_id, delivery_person_id, status, assigned_at')
        .in('status', ['assigned', 'accepted', 'in_progress', 'delivering']).in('order_id', orderIds);
      if (assignmentsError) console.warn('order_assignments load warning:', assignmentsError);
      else {
        assignmentsByOrderId = (assignmentsData || []).reduce((acc, a) => {
          if (!a?.order_id) return acc;
          if (!acc[a.order_id]) acc[a.order_id] = [];
          acc[a.order_id].push({ id: a.id, delivery_person_id: a.delivery_person_id, status: a.status, assigned_at: a.assigned_at });
          return acc;
        }, {});
      }
    }

    let itemsByOrderId = {};
    if (orderIds.length > 0) {
      const { data: itemsData, error: itemsError } = await supabase.from('order_items').select('*').in('order_id', orderIds);
      console.log('🔍 DEBUG order_items query result:', { itemsData, itemsError, orderIds });
      if (itemsError) console.warn('❌ order_items load warning:', itemsError);
      else {
        itemsByOrderId = (itemsData || []).reduce((acc, item) => {
          if (!item?.order_id) return acc;
          if (!acc[item.order_id]) acc[item.order_id] = [];
          acc[item.order_id].push(item);
          return acc;
        }, {});
        console.log('📦 itemsByOrderId mapping:', itemsByOrderId);
      }
    }

    const mergedOrders = ordersData.map((order) => {
      const dbItems = itemsByOrderId[order.id] || [];
      // CRITICAL: Only override order.items if dbItems actually has data.
      // The orders table has a JSONB 'items' column - don't replace it with empty array!
      const sourceOrder = dbItems.length > 0 ? { ...order, items: dbItems } : order;
      const fallbackItems = extractOrderItems(sourceOrder);
      if (fallbackItems.length === 0) {
        console.log(`⚠️ Order ${order.id} (${order.order_number}): No items found`, { items: order.items, cart_snapshot: order.cart_snapshot, sender_details_meta: order.sender_details?.meta });
      } else {
        console.log(`✅ Order ${order.id} (${order.order_number}): Found ${fallbackItems.length} items`);
      }
      return { ...order, order_assignments: assignmentsByOrderId[order.id] || [], items: fallbackItems };
    });

    const usersCouriers = (couriersResult.data || []).map((row) => ({
      id: row.auth_id || row.id, public_user_id: row.id, full_name: row.full_name,
      email: row.email, role: row.role, source: 'users',
    }));
    const adminCouriers = (adminCouriersResult.data || []).map((row) => ({
      id: row.id, public_user_id: null, full_name: row.name,
      email: row.email, role: row.role, source: 'admin_users',
    }));

    const mergedCouriersById = [...usersCouriers, ...adminCouriers].reduce((acc, c) => {
      if (!c?.id) return acc;
      if (!acc[c.id]) acc[c.id] = c;
      else acc[c.id] = { ...acc[c.id], full_name: acc[c.id].full_name || c.full_name, email: acc[c.id].email || c.email, public_user_id: acc[c.id].public_user_id || c.public_user_id };
      return acc;
    }, {});

    const publicCourierIds = Object.values(mergedCouriersById).map((r) => r.public_user_id).filter(Boolean);
    if (publicCourierIds.length > 0) {
      const [deliveryProfilesResult, courierProfilesResult] = await Promise.all([
        supabase
          .from('delivery_profiles')
          .select('user_id, vehicle_type, current_location, is_available')
          .in('user_id', publicCourierIds),
        supabase
          .from('courier_profiles')
          .select('user_id, phone, payout_cycle, onboarding_completed, first_delivery_completed_at, referral_code, balance_usd, balance_syp, completed_orders_count')
          .in('user_id', publicCourierIds),
      ]);

      if (!deliveryProfilesResult.error && Array.isArray(deliveryProfilesResult.data)) {
        const byPublicId = Object.values(mergedCouriersById).reduce((acc, c) => { if (c?.public_user_id) acc[c.public_user_id] = c.id; return acc; }, {});
        deliveryProfilesResult.data.forEach((p) => {
          const courierId = byPublicId[p.user_id];
          if (courierId && mergedCouriersById[courierId]) {
            mergedCouriersById[courierId] = { ...mergedCouriersById[courierId], vehicle_type: p.vehicle_type, current_location: p.current_location, is_available: p.is_available };
          }
        });
      }

      if (!courierProfilesResult.error && Array.isArray(courierProfilesResult.data)) {
        const byPublicId = Object.values(mergedCouriersById).reduce((acc, c) => { if (c?.public_user_id) acc[c.public_user_id] = c.id; return acc; }, {});
        courierProfilesResult.data.forEach((p) => {
          const courierId = byPublicId[p.user_id];
          if (courierId && mergedCouriersById[courierId]) {
            mergedCouriersById[courierId] = {
              ...mergedCouriersById[courierId],
              phone: p.phone,
              payout_cycle: p.payout_cycle,
              onboarding_completed: Boolean(p.onboarding_completed),
              first_delivery_completed_at: p.first_delivery_completed_at,
              referral_code: p.referral_code,
              balance_usd: Number(p.balance_usd || 0),
              balance_syp: Number(p.balance_syp || 0),
              completed_orders_count: Number(p.completed_orders_count || 0),
            };
          }
        });
      }
    }

    setOrders(mergedOrders);
    setCouriers(Object.values(mergedCouriersById));

    // Load Wasel+ memberships
    try {
      const { data: membershipsData, error: membershipsError } = await supabase
        .from('wasel_plus_memberships')
        .select('*')
        .order('updated_at', { ascending: false });
      if (!membershipsError && Array.isArray(membershipsData)) {
        setMemberships(membershipsData);
      }
    } catch (e) {
      console.warn('Memberships load warning:', e);
    }

    // Load latest USD/SYP exchange rate
    try {
      const { data: manualRow, error: manualError } = await supabase
        .from('app_exchange_rates')
        .select('rate')
        .eq('pair', 'USD_SYP')
        .eq('source', 'supervisor_manual')
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!manualError && manualRow?.rate) {
        const currentRate = Number(manualRow.rate);
        if (Number.isFinite(currentRate) && currentRate > 0) {
          setExchangeRateInput(String(currentRate));
        }
      } else {
        const { data: rateRow, error: rateError } = await supabase
          .from('app_exchange_rates')
          .select('rate')
          .eq('pair', 'USD_SYP')
          .order('fetched_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!rateError && rateRow?.rate) {
          const currentRate = Number(rateRow.rate);
          if (Number.isFinite(currentRate) && currentRate > 0) {
            setExchangeRateInput(String(currentRate));
          }
        }
      }
    } catch (e) {
      console.warn('Exchange rate load warning:', e);
    }
  };

  useEffect(() => {
    let ordersChannel = null;
    const bootstrap = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const authUser = authData?.user;
        if (!authUser) { navigate(createPageUrl('StaffLogin')); return; }

        const { data: userRow, error } = await supabase
          .from('users').select('id, full_name, email, role, auth_id')
          .or(`auth_id.eq.${authUser.id},id.eq.${authUser.id},email.eq.${authUser.email}`)
          .maybeSingle();

        let resolvedCurrentUser = null;
        if (!error && userRow && ADMIN_ROLES.includes(String(userRow.role || '').toLowerCase())) {
          resolvedCurrentUser = { id: userRow.id, name: userRow.full_name || authUser.email || 'Supervisor', email: userRow.email || authUser.email, role: String(userRow.role || 'admin').toLowerCase() };
        } else {
          const { data: adminRow, error: adminError } = await supabase
            .from('admin_users').select('id, email, name, role, is_active').eq('id', authUser.id).maybeSingle();
          if (!adminError && adminRow?.is_active && ['admin', 'supervisor'].includes(String(adminRow.role || '').toLowerCase())) {
            resolvedCurrentUser = { id: adminRow.id, name: adminRow.name || authUser.email || 'Supervisor', email: adminRow.email || authUser.email, role: String(adminRow.role || 'supervisor').toLowerCase() };
          }
        }

        if (!resolvedCurrentUser) { navigate(createPageUrl('Home')); return; }
        setCurrentUser(resolvedCurrentUser);
        await loadDashboardData();

        // Initialize push notifications for supervisor
        try { await initializePushNotifications(); } catch (e) { console.warn('Supervisor push init warning:', e); }

        // Subscribe to new orders in real-time
        ordersChannel = supabase
          .channel('supervisor-new-orders')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
            const newOrder = payload?.new;
            if (newOrder) {
              toast.info(`طلب جديد وارد #${newOrder.order_number || newOrder.id?.slice(0, 8) || ''}`, { duration: 8000 });
              loadDashboardData();
            }
          })
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () => {
            loadDashboardData();
          })
          .subscribe();
      } catch (error) {
        console.error('Supervisor bootstrap error:', error);
        toast.error('تعذر تحميل لوحة المشرف');
      } finally { setLoading(false); }
    };
    bootstrap();
    return () => {
      if (ordersChannel) supabase.removeChannel(ordersChannel);
    };
  }, [navigate]);

  // Load users when user-control section is opened
  useEffect(() => {
    if (activeSection === 'user-control') {
      loadUsers();
    }
    if (activeSection === 'reviews') {
      loadReviews();
    }
    if (activeSection === 'messages') {
      loadConversations();
    }
  }, [activeSection]);

  const loadReviews = async () => {
    setReviewsLoading(true);
    try {
      const { data, error } = await supabase
        .from('order_feedback')
        .select('*, orders(order_number, recipient_details)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) {
        // Fallback without join
        const { data: plain } = await supabase
          .from('order_feedback')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
        setReviewsFeedback(plain || []);
      } else {
        setReviewsFeedback(data || []);
      }
    } catch (err) {
      console.error('Load reviews error:', err);
    } finally {
      setReviewsLoading(false);
    }
  };

  const loadConversations = async () => {
    setConversationsLoading(true);
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(50);
      setConversations(data || []);
    } catch (err) {
      console.error('Load conversations error:', err);
    } finally {
      setConversationsLoading(false);
    }
  };

  const openConversation = async (conv) => {
    setActiveConversation(conv);
    try {
      const { data } = await supabase
        .from('direct_messages')
        .select('*')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: true })
        .limit(200);
      setChatMessages(data || []);

      // Mark unread messages as read
      const unreadIds = (data || [])
        .filter(m => !m.is_read && m.sender_id !== currentUser?.id)
        .map(m => m.id);
      if (unreadIds.length) {
        await supabase
          .from('direct_messages')
          .update({ is_read: true })
          .in('id', unreadIds);
      }
    } catch (err) {
      console.error('Load chat messages error:', err);
    }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !activeConversation || !currentUser) return;
    setSendingChat(true);
    try {
      const msg = {
        conversation_id: activeConversation.id,
        sender_id: currentUser.id,
        sender_name: currentUser.name || currentUser.email || 'المشرف',
        sender_role: 'supervisor',
        message: chatInput.trim(),
      };
      await supabase.from('direct_messages').insert([msg]);
      await supabase.from('conversations').update({
        last_message: chatInput.trim(),
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', activeConversation.id);

      setChatMessages(prev => [...prev, { ...msg, id: Date.now(), created_at: new Date().toISOString() }]);
      setChatInput('');

      // Notify the other participant via push
      const otherIds = (activeConversation.participant_ids || []).filter(id => id !== currentUser.id);
      if (otherIds.length) {
        try {
          const { notifySpecificUsers } = await import('@/services/firebaseOrderNotifications');
          await notifySpecificUsers('new_chat_message', { id: activeConversation.id }, otherIds, { senderName: msg.sender_name });
        } catch (e) { /* silently fail */ }
      }
    } catch (err) {
      console.error('Send chat error:', err);
      toast.error('فشل إرسال الرسالة');
    } finally {
      setSendingChat(false);
    }
  };

  // Subscribe to real-time chat messages when conversation is active
  useEffect(() => {
    if (!activeConversation) return;
    const channel = supabase.channel(`chat-${activeConversation.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'direct_messages',
        filter: `conversation_id=eq.${activeConversation.id}`,
      }, (payload) => {
        setChatMessages(prev => {
          if (prev.some(m => m.id === payload.new.id)) return prev;
          return [...prev, payload.new];
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeConversation?.id]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((order) => {
      const normalizedStatus = normalizeOrderStatus(order.status, order.payment_status);
      if (statusFilter !== 'all' && normalizedStatus !== statusFilter) return false;
      if (!q) return true;
      const name = String(order.recipient_details?.name || '').toLowerCase();
      const phone = String(order.recipient_details?.phone || '').toLowerCase();
      const number = String(order.order_number || order.id || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || number.includes(q);
    });
  }, [orders, search, statusFilter]);

  const handleAssignOrder = async (order) => {
    const courierId = selectedCourierByOrder[order.id] || '';
    if (!couriers || couriers.length === 0) { toast.error('لا يوجد موصلون متاحون حاليًا'); return; }
    if (!courierId) { toast.error('اختر موصلًا أولاً'); return; }

    const resolveCourierNotificationTargets = async (selectedCourierId) => {
      const targets = new Set([String(selectedCourierId)]);
      const selectedCourier = (couriers || []).find((c) => String(c?.id) === String(selectedCourierId));

      if (selectedCourier?.public_user_id) {
        targets.add(String(selectedCourier.public_user_id));
      }

      const courierEmail = String(selectedCourier?.email || '').trim().toLowerCase();
      if (courierEmail) {
        const [usersByEmail, adminsByEmail] = await Promise.all([
          supabase
            .from('users')
            .select('id, auth_id, email')
            .eq('email', courierEmail),
          supabase
            .from('admin_users')
            .select('id, email')
            .eq('email', courierEmail),
        ]);

        (usersByEmail.data || []).forEach((row) => {
          if (row?.id) targets.add(String(row.id));
          if (row?.auth_id) targets.add(String(row.auth_id));
        });
        (adminsByEmail.data || []).forEach((row) => {
          if (row?.id) targets.add(String(row.id));
        });
      }

      return Array.from(targets);
    };

    try {
      setAssigningOrderId(order.id);
      let didAssign = false;
      const existingAssignmentsArr = Array.isArray(order.order_assignments) ? order.order_assignments : (order.order_assignments ? [order.order_assignments] : []);
      const existingAssignment = existingAssignmentsArr.length > 0 ? existingAssignmentsArr[0] : null;

      if (existingAssignment?.delivery_person_id === courierId && String(existingAssignment.status || '').toLowerCase() === 'assigned') {
        toast.info('الطلب مفرز مسبقًا لنفس الموصل'); return;
      }

      if (existingAssignment?.id) {
        const { error } = await supabase.from('order_assignments').update({ delivery_person_id: courierId, status: 'assigned' }).eq('id', existingAssignment.id);
        if (error) throw error;
        didAssign = true;
      } else {
        const { error } = await supabase.from('order_assignments').insert({ order_id: order.id, delivery_person_id: courierId, assigned_by: currentUser.id, status: 'assigned' });
        if (error) throw error;
        didAssign = true;
      }

      const { error: updateOrderError } = await supabase.from('orders').update({ status: 'processing' }).eq('id', order.id);
      if (updateOrderError) {
        const canIgnore = updateOrderError?.code === '42501' && String(updateOrderError?.message || '').includes('order_status_history');
        if (!canIgnore) throw updateOrderError;
      }

      // Notify courier
      try {
        const courierTargets = await resolveCourierNotificationTargets(courierId);
        const notifyResult = await notifySpecificUsers('order_assigned', order, courierTargets);
        if (notifyResult && Number(notifyResult.total || 0) > 0) {
          if (Number(notifyResult.sent || 0) > 0) toast.success(`تم إرسال ${notifyResult.sent} إشعار Firebase`);
          else toast.warning('تم الفرز لكن لم يتم إرسال Push (تحقق من token/الجهاز)');
        }
      } catch (notifyError) { console.warn('Assign notify warning:', notifyError); }

      // Notify sender/recipient about status change
      try { await notifyOrderUsers('order_status_changed', { ...order, status: 'processing' }, { newStatus: 'processing' }); }
      catch (e) { console.warn('Status notification warning:', e); }

      if (didAssign) toast.success('تم فرز الطلب بنجاح');
      await loadDashboardData();
    } catch (error) {
      console.error('Assign order error:', error);
      toast.error('تعذر فرز الطلب للموصل');
    } finally { setAssigningOrderId(null); }
  };

  const handleUnassignOrder = async (order) => {
    const existingAssignmentsArr = Array.isArray(order.order_assignments) ? order.order_assignments : (order.order_assignments ? [order.order_assignments] : []);
      const existingAssignment = existingAssignmentsArr.length > 0 ? existingAssignmentsArr[0] : null;
    if (!existingAssignment?.id) { toast.info('لا يوجد فرز فعال لهذا الطلب'); return; }

    try {
      setAssigningOrderId(order.id);
      await supabase.from('order_assignments').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', existingAssignment.id);
      const { error: updateOrderError } = await supabase.from('orders').update({ status: 'pending' }).eq('id', order.id);
      if (updateOrderError) {
        const canIgnore = updateOrderError?.code === '42501' && String(updateOrderError?.message || '').includes('order_status_history');
        if (!canIgnore) throw updateOrderError;
      }
      setSelectedCourierByOrder((prev) => ({ ...prev, [order.id]: '' }));
      toast.success('تم إلغاء فرز الطلب بنجاح');
      await loadDashboardData();
    } catch (error) {
      console.error('Unassign order error:', error);
      toast.error('تعذر إلغاء فرز الطلب');
    } finally { setAssigningOrderId(null); }
  };

  const handleDeleteOrder = async (order) => {
    const orderLabel = order.order_number || String(order.id).slice(0, 8);
    const confirmed = window.confirm(`هل أنت متأكد من حذف الطلب #${orderLabel}؟\n\nسيتم حذف الطلب وجميع بياناته بشكل نهائي.`);
    if (!confirmed) return;

    try {
      setDeletingOrderId(order.id);
      // Delete related records first
      await supabase.from('order_assignments').delete().eq('order_id', order.id).catch(() => {});
      await supabase.from('order_items').delete().eq('order_id', order.id).catch(() => {});
      await supabase.from('delivery_proofs').delete().eq('order_id', order.id).catch(() => {});

      const { error } = await supabase.from('orders').delete().eq('id', order.id);
      if (error) throw error;

      toast.success(`تم حذف الطلب #${orderLabel} بنجاح`);
      await loadDashboardData();
    } catch (error) {
      console.error('Delete order error:', error);
      toast.error('تعذر حذف الطلب');
    } finally { setDeletingOrderId(null); }
  };

  const handleUpdateStatus = async (orderId, nextStatus) => {
    if (!nextStatus) return;
    try {
      setUpdatingStatusForOrder(orderId);
      const { error } = await supabase.from('orders').update({ status: nextStatus }).eq('id', orderId);
      if (error) throw error;

      // Notify sender/recipient about the status change
      const order = orders.find((o) => o.id === orderId);
      if (order) {
        try { await notifyOrderUsers('order_status_changed', { ...order, status: nextStatus }, { newStatus: nextStatus }); }
        catch (e) { console.warn('Status change notification warning:', e); }
      }

      toast.success('تم تحديث حالة الطلب');
      await loadDashboardData();
    } catch (error) {
      console.error('Update status error:', error);
      toast.error('فشل تحديث الحالة');
    } finally { setUpdatingStatusForOrder(null); }
  };

  const handleSaveDeliveryTime = async (orderId) => {
    const dt = deliveryTimeByOrder[orderId];
    if (!dt?.date && !dt?.time) { toast.error('اختر التاريخ أو الوقت'); return; }
    try {
      setSavingDeliveryTime(orderId);
      const updates = {};
      if (dt.date) updates.preferred_delivery_date = dt.date;
      if (dt.time) updates.preferred_delivery_time = dt.time;
      updates.delivery_time = `${dt.date || ''} ${dt.time || ''}`.trim();
      const { error } = await supabase.from('orders').update(updates).eq('id', orderId);
      if (error) throw error;
      toast.success('تم حفظ وقت التوصيل');
      await loadDashboardData();
    } catch (error) {
      console.error('Save delivery time error:', error);
      toast.error('فشل حفظ وقت التوصيل');
    } finally { setSavingDeliveryTime(null); }
  };

  const handleActivateMembership = async (membership) => {
    try {
      setActivatingMembership(membership.id || membership.user_email);
      const now = new Date();
      const periodDays = membership.plan_type === 'yearly' ? 365 : 30;
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() + periodDays);

      const { error } = await supabase
        .from('wasel_plus_memberships')
        .update({
          status: 'active',
          start_date: now.toISOString(),
          end_date: endDate.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq('user_email', membership.user_email);

      if (error) throw error;
      toast.success(`تم تفعيل اشتراك ${membership.user_email}`);
      await loadDashboardData();
    } catch (error) {
      console.error('Activate membership error:', error);
      toast.error('فشل تفعيل الاشتراك');
    } finally { setActivatingMembership(null); }
  };

  const handleMembershipEditChange = (membership, key, value) => {
    const rowKey = membership.id || membership.user_email;
    setMembershipEdits((prev) => ({
      ...prev,
      [rowKey]: {
        ...prev[rowKey],
        [key]: value,
      },
    }));
  };

  const handleSaveMembershipDates = async (membership) => {
    const rowKey = membership.id || membership.user_email;
    const draft = membershipEdits[rowKey] || {};
    const nextStartDate = draft.start_date || toDateInputValue(membership.start_date);
    const nextEndDate = draft.end_date || toDateInputValue(membership.end_date);

    if (!nextStartDate && !nextEndDate) {
      toast.error('حدد تاريخ بداية أو نهاية على الأقل');
      return;
    }

    try {
      setSavingMembershipId(rowKey);

      const updates = {
        updated_at: new Date().toISOString(),
      };

      if (nextStartDate) updates.start_date = new Date(`${nextStartDate}T00:00:00.000Z`).toISOString();
      if (nextEndDate) updates.end_date = new Date(`${nextEndDate}T23:59:59.000Z`).toISOString();

      const { error } = await supabase
        .from('wasel_plus_memberships')
        .update(updates)
        .eq('user_email', membership.user_email);

      if (error) throw error;
      toast.success('تم تحديث تواريخ العضوية');
      await loadDashboardData();
    } catch (error) {
      console.error('Update membership dates error:', error);
      toast.error('فشل تحديث تواريخ العضوية');
    } finally {
      setSavingMembershipId(null);
    }
  };

  const handleCancelMembership = async (membership) => {
    try {
      setSavingMembershipId(membership.id || membership.user_email);

      const { error } = await supabase
        .from('wasel_plus_memberships')
        .update({
          status: 'cancelled',
          end_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_email', membership.user_email);

      if (error) throw error;
      toast.success('تم إلغاء العضوية');
      await loadDashboardData();
    } catch (error) {
      console.error('Cancel membership error:', error);
      toast.error('فشل إلغاء العضوية');
    } finally {
      setSavingMembershipId(null);
    }
  };

  const handleUpdateExchangeRate = async () => {
    const normalizedInput = normalizeDecimalInput(exchangeRateInput);
    const numericRate = Number(normalizedInput);
    if (!Number.isFinite(numericRate) || numericRate <= 0) {
      toast.error('أدخل سعر صرف صحيح');
      return;
    }

    setExchangeRateInput(normalizedInput);

    try {
      setSavingExchangeRate(true);

      let rpcError = null;
      try {
        const { error } = await supabase.rpc('set_current_usd_syp_rate', {
          p_rate: numericRate,
          p_source: 'supervisor_manual',
        });
        rpcError = error;
      } catch (error) {
        rpcError = error;
      }

      if (rpcError) {
        const { error: insertError } = await supabase
          .from('app_exchange_rates')
          .insert([{ pair: 'USD_SYP', rate: numericRate, source: 'supervisor_manual' }]);
        if (insertError) throw insertError;
      }

      // Reflect updated rate immediately across product and cart views.
      updateUsdToSypRateCache(numericRate);

      toast.success('تم تحديث سعر الصرف');
      await loadDashboardData();
    } catch (error) {
      console.error('Update exchange rate error:', error);
      toast.error('فشل تحديث سعر الصرف');
    } finally {
      setSavingExchangeRate(false);
    }
  };

  const handleResetWallet = async (walletId, amount, userId) => {
    if (!window.confirm('هل أنت متأكد من تصفير رصيد هذه المحفظة؟')) return;
    try {
      setResettingWalletId(walletId);
      const { error } = await supabase.from('wallets').update({ balance_usd: 0 }).eq('id', walletId);
      if (error) throw error;

      if (userId) {
         await supabase.from('wallet_transactions').insert([{
           user_id: userId,
           amount_usd: -amount,
           type: 'admin_adjustment',
           source: 'admin',
           description: 'تصفير رصيد المحفظة من قبل المشرف',
           balance_after: 0
         }]);
      }

      toast.success('تم تصفير رصيد المحفظة للمستخدم');
      await loadDashboardData();
    } catch (error) {
      console.error('Wallet reset error:', error);
      toast.error('فشل تصفير رصيد المحفظة');
    } finally {
      setResettingWalletId(null);
    }
  };

  const handleResetCourierBalance = async (courier) => {
    if (!courier?.public_user_id) {
      toast.error('لا يمكن تصفير هذا الموصل لأنه غير مرتبط بجدول users');
      return;
    }

    const amountUsd = Number(courier.balance_usd || 0);
    const amountSyp = Number(courier.balance_syp || 0);
    const hasAnyBalance = amountUsd > 0 || amountSyp > 0 || Number(courier.completed_orders_count || 0) > 0;

    if (!hasAnyBalance) {
      toast.info('لا يوجد رصيد يحتاج تصفير');
      return;
    }

    try {
      setResettingCourierId(courier.id);

      const { error: resetError } = await supabase
        .from('courier_profiles')
        .update({
          balance_usd: 0,
          balance_syp: 0,
          completed_orders_count: 0,
          first_delivery_completed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', courier.public_user_id);

      if (resetError) throw resetError;

      await supabase
        .from('courier_payout_resets')
        .insert({
          courier_user_id: courier.public_user_id,
          amount_usd: amountUsd,
          amount_syp: amountSyp,
          note: `manual payout reset by ${currentUser?.email || 'supervisor'}`,
        });

      toast.success('تم تصفير رصيد الموصل بعد التسديد');
      await loadDashboardData();
    } catch (error) {
      console.error('Reset courier balance error:', error);
      toast.error('فشل تصفير رصيد الموصل');
    } finally {
      setResettingCourierId(null);
    }
  };

  const openWhatsAppRecipient = (order) => {
    const phone = order.recipient_details?.phone || '';
    const recipientName = order.recipient_details?.name || 'العميل';
    const orderLabel = order.order_number || order.id;
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    if (!cleanPhone || cleanPhone.length < 6) { toast.error('لا يوجد رقم هاتف صالح للمستلم'); return; }
    const waPhone = cleanPhone.startsWith('+') ? cleanPhone.slice(1) : cleanPhone;
    const message = [
      `مرحباً ${recipientName} 👋`,
      ``,
      `نحن فريق واصل (Wasel) نتواصل معك بخصوص طلبك رقم ${orderLabel}.`,
      ``,
      `كيف يمكننا مساعدتك؟`,
      ``,
      `شكراً لثقتك بواصل 🚚`,
    ].join('\n');
    const url = `https://wa.me/${encodeURIComponent(waPhone)}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleLogout = async () => {
    try { setSigningOut(true); await supabase.auth.signOut(); navigate(createPageUrl('StaffLogin')); }
    finally { setSigningOut(false); }
  };

  const handleManualRefreshDashboard = async () => {
    try {
      setRefreshingDashboard(true);
      await loadDashboardData();
      toast.success('تم تحديث لوحة الطلبات');
    } catch (error) {
      console.error('Manual dashboard refresh error:', error);
      toast.error('تعذر تحديث لوحة الطلبات');
    } finally {
      setRefreshingDashboard(false);
    }
  };

  const loadUsers = async () => {
    try {
      setLoadingUsers(true);
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, email, phone, role')
        .order('full_name', { ascending: true });
      
      if (error) throw error;
      setUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Load users error:', error);
      toast.error('تعذر تحميل قائمة المستخدمين');
    } finally {
      setLoadingUsers(false);
    }
  };

  const updateUserWallet = async (userId, amount, operation) => {
    if (!userId || !amount || !operation) return;
    
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error('يرجى إدخال مبلغ صحيح');
      return;
    }

    try {
      setUpdatingUserWallet(userId);

      // Get current wallet
      const { data: wallet, error: fetchError } = await supabase
        .from('wallets')
        .select('id, balance_usd')
        .eq('user_id', userId)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

      const currentBalance = wallet?.balance_usd || 0;
      const newBalance = operation === 'add' 
        ? currentBalance + numAmount 
        : Math.max(0, currentBalance - numAmount);

      // Update or insert wallet
      if (wallet?.id) {
        const { error: updateError } = await supabase
          .from('wallets')
          .update({ balance_usd: newBalance, updated_at: new Date().toISOString() })
          .eq('id', wallet.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('wallets')
          .insert({
            user_id: userId,
            balance_usd: newBalance,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        if (insertError) throw insertError;
      }

      // Log transaction
      await supabase.from('wallet_transactions').insert({
        user_id: userId,
        amount_usd: operation === 'add' ? numAmount : -numAmount,
        type: 'admin_adjustment',
        source: 'admin',
        description: operation === 'add' ? `إضافة ${numAmount}$ من المشرف` : `خصم ${numAmount}$ من المشرف`,
        balance_after: newBalance,
      });

      toast.success(`تم ${operation === 'add' ? 'إضافة' : 'خصم'} ${numAmount}$ بنجاح`);
      setWalletAmountToAdd('');
      setWalletAmountToReduce('');
      setSelectedUserForWallet(null);
      await loadUsers();
    } catch (error) {
      console.error('Update wallet error:', error);
      toast.error('فشل تحديث المحفظة');
    } finally {
      setUpdatingUserWallet(null);
    }
  };

  // Keep hooks before any conditional return to preserve hook order across renders.
  const analyticsData = useMemo(() => {
    const completedOrders = orders.filter(o => normalizeOrderStatus(o.status, o.payment_status) === 'completed');
    const totalRevenueUSD = completedOrders.reduce((sum, o) => sum + getOrderTotalUSD(o), 0);
    const totalRevenueSYP = completedOrders.reduce((sum, o) => sum + getOrderTotalSYP(o), 0);
    const avgOrderValueUSD = completedOrders.length > 0 ? totalRevenueUSD / completedOrders.length : 0;

    // Orders by day (last 30 days)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recentOrders = orders.filter(o => new Date(o.created_at) >= thirtyDaysAgo);
    const ordersByDay = {};
    recentOrders.forEach(o => {
      const day = new Date(o.created_at).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
      ordersByDay[day] = (ordersByDay[day] || 0) + 1;
    });

    // Revenue by payment method
    const revenueByMethod = {};
    completedOrders.forEach(o => {
      const method = o.payment_method || o.paymentMethod || 'غير محدد';
      revenueByMethod[method] = (revenueByMethod[method] || 0) + getOrderTotalUSD(o);
    });

    // Courier performance
    const courierPerf = couriers.map(c => ({
      name: c.full_name || c.name || c.email || 'موصل',
      completedOrders: Number(c.completed_orders_count || 0),
      balance: Number(c.balance_usd || 0),
    })).sort((a, b) => b.completedOrders - a.completedOrders);

    // Conversion rate
    const conversionRate = orders.length > 0 ? ((completedOrders.length / orders.length) * 100).toFixed(1) : '0';

    return { totalRevenueUSD, totalRevenueSYP, avgOrderValueUSD, ordersByDay, revenueByMethod, courierPerf, conversionRate, completedOrders };
  }, [orders, couriers]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7FAF9] flex-col gap-4">
        <SmartLottie
          animationPath={ANIMATION_PRESETS.pageLoading.path}
          width={80}
          height={80}
          trigger="never"
          autoplay={true}
          loop={true}
        />
        <p className="text-[#475569] font-['Cairo'] font-bold">جاري تحميل لوحة المشرف...</p>
      </div>
    );
  }

  const processingOrdersCount = orders.filter((o) => normalizeOrderStatus(o.status, o.payment_status) === 'processing').length;
  const pendingOrdersCount = orders.filter((o) => normalizeOrderStatus(o.status, o.payment_status) === 'pending').length;
  const deliveringOrdersCount = orders.filter((o) => normalizeOrderStatus(o.status, o.payment_status) === 'delivering').length;
  const completedOrdersCount = orders.filter((o) => normalizeOrderStatus(o.status, o.payment_status) === 'completed').length;
  const cancelledOrdersCount = orders.filter((o) => normalizeOrderStatus(o.status, o.payment_status) === 'cancelled').length;
  const activeCouriersCount = couriers.filter((c) => c.is_available !== false).length;
  const pendingMembershipsCount = memberships.filter((m) => m.status === 'pending_whatsapp').length;

  // Export to CSV
  const exportOrdersCSV = () => {
    const headers = ['رقم الطلب', 'التاريخ', 'الحالة', 'طريقة الدفع', 'المبلغ USD', 'المبلغ SYP', 'المرسل', 'المستلم'];
    const rows = orders.map(o => [
      o.order_number || o.id?.slice(0, 8),
      new Date(o.created_at).toLocaleDateString('ar-EG'),
      STATUS_LABELS_AR[normalizeOrderStatus(o.status, o.payment_status)] || o.status,
      o.payment_method || '',
      getOrderTotalUSD(o).toFixed(2),
      getOrderTotalSYP(o).toFixed(0),
      o.sender_details?.name || '',
      o.recipient_details?.name || '',
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wasel-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('تم تصدير البيانات بنجاح');
  };

  return (
    <div className="min-h-screen bg-[#F7FAF9] font-['Cairo']" dir="rtl">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-gradient-to-l from-[#1B4332] via-[#2D6A4F] to-[#40916C] shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/logo/wasel-logo.png" alt="Wasel" className="h-10 w-10 rounded-xl border border-white/30 bg-white p-1"
              onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            <div>
              <h1 className="text-xl font-black text-white tracking-tight">لوحة إدارة واصل</h1>
              <p className="text-xs text-white/70">مرحبًا {currentUser?.name} - إدارة كاملة للطلبات</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate(createPageUrl('SupervisorGuide'))}
              className="border-white/30 text-white bg-white/10 hover:bg-white/20 rounded-xl text-xs"
            >
              <BookOpen className="w-4 h-4 ml-1" />
              الدليل
            </Button>
            <Button
              variant="outline"
              onClick={handleManualRefreshDashboard}
              disabled={refreshingDashboard}
              className="border-white/30 text-white bg-white/10 hover:bg-white/20 rounded-xl text-xs"
            >
              {refreshingDashboard ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <RefreshCcw className="w-4 h-4 ml-1" />}
              تحديث
            </Button>
            <Button variant="outline" onClick={handleLogout} disabled={signingOut}
              className="border-white/30 text-white bg-white/10 hover:bg-white/20 rounded-xl text-xs">
              <LogOut className="w-4 h-4 ml-1" />
              {signingOut ? 'جارٍ...' : 'خروج'}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Stats Cards */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
          {[
            { title: 'كل الطلبات', value: orders.length, icon: ClipboardList, gradient: 'from-[#1B4332] to-[#2D6A4F]' },
            { title: 'قيد انتظار القبول', value: pendingOrdersCount, icon: Package, gradient: 'from-[#D97706] to-[#FBBF24]' },
            { title: 'تم القبول ويتم تجهيز الطلب', value: processingOrdersCount, icon: Bell, gradient: 'from-[#059669] to-[#34D399]' },
            { title: 'جاري التوصيل', value: deliveringOrdersCount, icon: ShieldCheck, gradient: 'from-[#7C3AED] to-[#A78BFA]' },
            { title: 'مكتملة', value: completedOrdersCount, icon: TrendingUp, gradient: 'from-[#10B981] to-[#6EE7B7]' },
            { title: 'الإيرادات ($)', value: `$${analyticsData.totalRevenueUSD.toFixed(0)}`, icon: BarChart3, gradient: 'from-[#3B82F6] to-[#93C5FD]' },
            { title: 'اشتراكات Wasel+', value: `${pendingMembershipsCount}/${memberships.length}`, icon: Crown, gradient: 'from-[#F59E0B] to-[#F97316]' },
          ].map((card, i) => (
            <motion.div key={card.title} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className={`rounded-2xl bg-gradient-to-br ${card.gradient} text-white p-4`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs opacity-80">{card.title}</p>
                  <p className="text-3xl font-black mt-1">{card.value}</p>
                </div>
                <card.icon className="w-7 h-7 opacity-70" />
              </div>
            </motion.div>
          ))}
        </div>

        {/* Section Tabs */}
        <div className="rounded-2xl border border-[#E7ECEA] bg-white p-2">
          <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
            {PANEL_SECTIONS.map((section) => {
              const Icon = section.icon;
              const active = activeSection === section.key;
              return (
                <button key={section.key} type="button" onClick={() => setActiveSection(section.key)}
                  className={`rounded-xl px-3 py-3 text-sm font-bold transition ${active ? 'bg-[#1B4332] text-white' : 'bg-[#FAFCFB] text-[#475569] hover:bg-[#ECFDF5]'}`}>
                  <span className="inline-flex items-center gap-2"><Icon className="w-4 h-4" />{section.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Overview Section */}
        {activeSection === 'overview' && (
          <section className="grid gap-4 lg:grid-cols-3">
            {pendingMembershipsCount > 0 && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                className="lg:col-span-3 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-300 p-4 cursor-pointer"
                onClick={() => setActiveSection('memberships')}>
                <div className="flex items-center gap-3">
                  <Crown className="w-6 h-6 text-amber-600" />
                  <div>
                    <p className="font-bold text-amber-800">{pendingMembershipsCount} طلب اشتراك Wasel+ بانتظار التفعيل</p>
                    <p className="text-xs text-amber-600">اضغط هنا للانتقال إلى إدارة الاشتراكات</p>
                  </div>
                </div>
              </motion.div>
            )}
            <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-3xl border border-[#E7ECEA] bg-white p-5 lg:col-span-2 shadow-sm">
              <h3 className="text-lg font-black text-[#1B4332] mb-3">ملخص التشغيل اليومي</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-[#ECFDF5] p-3 border border-[#D1FAE5]">
                  <p className="text-xs text-[#059669]">الموصلون النشطون</p>
                  <p className="text-2xl font-black text-[#065F46]">{activeCouriersCount}</p>
                </div>
                <div className="rounded-xl bg-[#FEF3C7] p-3 border border-[#FDE68A]">
                  <p className="text-xs text-[#D97706]">قيد انتظار القبول</p>
                  <p className="text-2xl font-black text-[#92400E]">{pendingOrdersCount}</p>
                </div>
                <div className="rounded-xl bg-[#EFF6FF] p-3 border border-[#BFDBFE]">
                  <p className="text-xs text-[#2563EB]">تم القبول ويتم تجهيز الطلب</p>
                  <p className="text-2xl font-black text-[#1D4ED8]">{processingOrdersCount}</p>
                </div>
              </div>
            </motion.article>

            <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="rounded-3xl border border-[#E7ECEA] bg-white p-5 shadow-sm">
              <h3 className="text-lg font-black text-[#1B4332] mb-3">وصول سريع</h3>
              <div className="space-y-2">
                <Button onClick={() => setActiveSection('orders')} className="w-full bg-[#1B4332] hover:bg-[#2D6A4F] rounded-xl">إدارة الطلبات</Button>
                <Button onClick={() => setActiveSection('couriers')} variant="outline" className="w-full rounded-xl border-[#1B4332]/20 text-[#1B4332]">بيانات الموصلين</Button>
                <Button onClick={() => navigate(createPageUrl('Home'))} variant="outline" className="w-full rounded-xl border-[#1B4332]/20 text-[#1B4332]">فتح الموقع كعميل</Button>
              </div>
            </motion.article>
          </section>
        )}

        {/* Analytics Section - تحليلات متقدمة */}
        {activeSection === 'analytics' && (
          <section className="space-y-4">
            {/* Export Button */}
            <div className="flex justify-end gap-2">
              <Button onClick={exportOrdersCSV} className="bg-[#1B4332] hover:bg-[#2D6A4F] rounded-xl text-sm">
                <Download className="w-4 h-4 ml-1" />
                تصدير CSV
              </Button>
            </div>

            {/* Revenue Cards */}
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-400 text-white p-4">
                <p className="text-xs opacity-80">إجمالي الإيرادات (USD)</p>
                <p className="text-2xl font-black mt-1">${analyticsData.totalRevenueUSD.toFixed(2)}</p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
                className="rounded-2xl bg-gradient-to-br from-blue-600 to-blue-400 text-white p-4">
                <p className="text-xs opacity-80">إجمالي الإيرادات (ل.س)</p>
                <p className="text-2xl font-black mt-1">{analyticsData.totalRevenueSYP.toLocaleString()}</p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                className="rounded-2xl bg-gradient-to-br from-amber-500 to-amber-300 text-white p-4">
                <p className="text-xs opacity-80">متوسط قيمة الطلب</p>
                <p className="text-2xl font-black mt-1">${analyticsData.avgOrderValueUSD.toFixed(2)}</p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
                className="rounded-2xl bg-gradient-to-br from-purple-600 to-purple-400 text-white p-4">
                <p className="text-xs opacity-80">معدل التحويل</p>
                <p className="text-2xl font-black mt-1">{analyticsData.conversionRate}%</p>
              </motion.div>
            </div>

            {/* Status breakdown */}
            <div className="rounded-2xl border border-[#E7ECEA] bg-white p-5">
              <h3 className="text-lg font-black text-[#1B4332] mb-4 flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                توزيع الطلبات حسب الحالة
              </h3>
              <div className="space-y-3">
                {[
                  { label: 'قيد الانتظار', count: pendingOrdersCount, color: 'bg-amber-500', total: orders.length },
                  { label: 'تم القبول', count: processingOrdersCount, color: 'bg-blue-500', total: orders.length },
                  { label: 'جاري التوصيل', count: deliveringOrdersCount, color: 'bg-purple-500', total: orders.length },
                  { label: 'مكتمل', count: completedOrdersCount, color: 'bg-green-500', total: orders.length },
                  { label: 'ملغي', count: cancelledOrdersCount, color: 'bg-red-500', total: orders.length },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-3">
                    <span className="text-sm font-bold text-[#475569] w-24 text-right">{item.label}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                      <div className={`${item.color} h-full rounded-full flex items-center justify-end px-2 transition-all duration-500`}
                        style={{ width: `${item.total > 0 ? Math.max((item.count / item.total) * 100, 2) : 0}%` }}>
                        <span className="text-xs font-bold text-white">{item.count}</span>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-[#94A3B8] w-12">{item.total > 0 ? ((item.count / item.total) * 100).toFixed(0) : 0}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Orders by day (visual bar chart) */}
            <div className="rounded-2xl border border-[#E7ECEA] bg-white p-5">
              <h3 className="text-lg font-black text-[#1B4332] mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                الطلبات (آخر 30 يوم)
              </h3>
              <div className="flex items-end gap-1 h-40 overflow-x-auto pb-8">
                {Object.entries(analyticsData.ordersByDay).slice(-15).map(([day, count]) => {
                  const maxCount = Math.max(...Object.values(analyticsData.ordersByDay), 1);
                  return (
                    <div key={day} className="flex flex-col items-center gap-1 min-w-[2.5rem] flex-1">
                      <span className="text-xs font-bold text-[#1B4332]">{count}</span>
                      <div className="w-full bg-[#1B4332]/80 rounded-t-lg" style={{ height: `${(count / maxCount) * 100}%`, minHeight: '4px' }} />
                      <span className="text-[9px] text-[#94A3B8] truncate w-full text-center">{day}</span>
                    </div>
                  );
                })}
              </div>
              {Object.keys(analyticsData.ordersByDay).length === 0 && (
                <p className="text-center text-gray-400 text-sm py-8">لا توجد طلبات في آخر 30 يوم</p>
              )}
            </div>

            {/* Revenue by payment method */}
            <div className="rounded-2xl border border-[#E7ECEA] bg-white p-5">
              <h3 className="text-lg font-black text-[#1B4332] mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                الإيرادات حسب طريقة الدفع
              </h3>
              <div className="space-y-2">
                {Object.entries(analyticsData.revenueByMethod).sort(([,a],[,b]) => b - a).map(([method, amount]) => (
                  <div key={method} className="flex items-center justify-between p-3 rounded-xl bg-[#FAFCFB] border border-[#E7ECEA]">
                    <span className="text-sm font-bold text-[#1B4332]">
                      {method === 'paypal' ? '💳 PayPal' : method === 'wallet' ? '👛 المحفظة' : method === 'whatsapp' ? '📱 واتساب' : method === 'shared_cart' ? '🛒 سلة مشتركة' : method}
                    </span>
                    <span className="font-black text-[#1B4332]">${amount.toFixed(2)}</span>
                  </div>
                ))}
                {Object.keys(analyticsData.revenueByMethod).length === 0 && (
                  <p className="text-center text-gray-400 text-sm py-4">لا توجد إيرادات بعد</p>
                )}
              </div>
            </div>

            {/* Top couriers */}
            <div className="rounded-2xl border border-[#E7ECEA] bg-white p-5">
              <h3 className="text-lg font-black text-[#1B4332] mb-4 flex items-center gap-2">
                <Truck className="w-5 h-5" />
                أداء الموصلين
              </h3>
              <div className="space-y-2">
                {analyticsData.courierPerf.slice(0, 10).map((courier, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-[#FAFCFB] border border-[#E7ECEA]">
                    <div className="flex items-center gap-3">
                      <span className="w-7 h-7 rounded-full bg-[#1B4332] text-white flex items-center justify-center text-xs font-bold">{idx + 1}</span>
                      <span className="text-sm font-bold text-[#1B4332]">{courier.name}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-[#64748B]">{courier.completedOrders} طلب مكتمل</span>
                      <span className="font-bold text-[#1B4332]">${courier.balance.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
                {analyticsData.courierPerf.length === 0 && (
                  <p className="text-center text-gray-400 text-sm py-4">لا توجد بيانات موصلين</p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Orders Section */}
        {activeSection === 'orders' && (
          <>
            <section className="rounded-2xl border border-[#E7ECEA] bg-white p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="relative md:col-span-2">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
                  <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="ابحث بالاسم أو الهاتف أو رقم الطلب"
                    className="w-full rounded-xl border border-[#E5E7EB] bg-[#FAFCFB] py-2.5 pr-10 pl-3 text-sm focus:border-[#1B4332] focus:outline-none" />
                </div>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-xl border border-[#E5E7EB] bg-[#FAFCFB] px-3 py-2.5 text-sm focus:border-[#1B4332] focus:outline-none">
                  <option value="all">كل الحالات</option>
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS_AR[s] || s}</option>)}
                </select>
              </div>
            </section>

            <section className="space-y-4">
              {filteredOrders.map((order, idx) => {
                const assignment = Array.isArray(order.order_assignments) && order.order_assignments.length > 0 ? order.order_assignments[0] : null;
                const normalizedStatus = normalizeOrderStatus(order.status, order.payment_status);
                const selectedCourierValue = Object.prototype.hasOwnProperty.call(selectedCourierByOrder, order.id)
                  ? selectedCourierByOrder[order.id] : (assignment?.delivery_person_id || '');
                const isExpanded = expandedOrderIds.has(order.id);
                const allItems = extractOrderItems(order);
                const exchangeRate = getExchangeRate(order);
                const flowType = detectOrderFlowType(order);
                const sharedCartUrl = getSharedCartUrl(order);
                const showRecipientOnly = flowType === 'inside';
                const recipientEmail = order.recipient_details?.email || order.sender_details?.email || '-';

                return (
                  <motion.article key={order.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}
                    className="rounded-3xl border border-[#E7ECEA] bg-white shadow-sm overflow-hidden">
                    <div className="p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-black text-[#1B4332] text-lg">طلب #{order.order_number || String(order.id).slice(0, 8)}</h3>
                            <Badge className="bg-[#F1F5F9] text-[#475569] border-0 text-xs">{STATUS_LABELS_AR[normalizedStatus] || normalizedStatus}</Badge>
                            <Badge className={`${orderFlowBadgeClass(flowType)} border-0 text-xs`}>{orderFlowLabel(flowType)}</Badge>
                          </div>
                          <p className="text-sm text-[#475569]">
                            {order.recipient_details?.name || 'بدون اسم'} - {order.recipient_details?.phone || '-'}
                          </p>
                          <p className="text-xs text-[#94A3B8]">{order.recipient_details?.address || 'لا يوجد عنوان'}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge className="bg-[#ECFDF5] text-[#059669] border-0 text-xs font-bold">
                            ${getOrderTotalUSD(order).toFixed(2)}
                          </Badge>
                          <Badge className="bg-[#FEF3C7] text-[#92400E] border-0 text-xs font-bold">
                            {Math.round(getOrderTotalSYP(order)).toLocaleString('en-US')} ل.س
                          </Badge>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => toggleOrderDetails(order.id)}
                          className="rounded-xl border-[#1B4332]/20 text-[#1B4332]">
                          {isExpanded ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
                          {isExpanded ? 'إخفاء' : 'التفاصيل'}
                        </Button>
                        <Button size="sm" onClick={() => handleDownloadInvoice(order)}
                          className="rounded-xl bg-[#059669] hover:bg-[#047857] text-white">
                          <FileDown className="w-3.5 h-3.5 ml-1" /> الفاتورة
                        </Button>
                        <Button size="sm" onClick={() => openWhatsAppRecipient(order)}
                          className="rounded-xl bg-[#25D366] hover:bg-[#128C7E] text-white">
                          <MessageCircle className="w-3.5 h-3.5 ml-1" /> واتساب المستلم
                        </Button>
                        <Button size="sm" onClick={() => handleDeleteOrder(order)}
                          disabled={deletingOrderId === order.id}
                          variant="outline"
                          className="rounded-xl border-red-300 text-red-600 hover:bg-red-50">
                          {deletingOrderId === order.id ? <Loader2 className="w-3.5 h-3.5 ml-1 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 ml-1" />}
                          حذف
                        </Button>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border-t border-[#E7ECEA] p-5 space-y-4">
                        {/* Sender & Recipient */}
                        <div className={`grid gap-3 ${showRecipientOnly ? 'md:grid-cols-1' : 'md:grid-cols-2'}`}>
                          {!showRecipientOnly && (
                            <div className="rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] p-3">
                              <p className="text-xs text-[#1D4ED8] font-bold mb-1">بيانات المرسل</p>
                              <p className="text-sm text-[#1E3A5F]">{order.sender_details?.name || '-'}</p>
                              <p className="text-sm text-[#475569]">{order.sender_details?.phone || '-'}</p>
                              {order.sender_details?.email && <p className="text-sm text-[#475569]">{order.sender_details.email}</p>}
                              {flowType === 'shared' && sharedCartUrl && (
                                <a
                                  href={sharedCartUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#1D4ED8] hover:underline"
                                >
                                  <LinkIcon className="w-3.5 h-3.5" />
                                  رابط السلة المشتركة
                                </a>
                              )}
                            </div>
                          )}
                          <div className="rounded-xl bg-[#FEF3C7] border border-[#FDE68A] p-3">
                            <p className="text-xs text-[#92400E] font-bold mb-1 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> بيانات المستلم</p>
                            <p className="text-sm text-[#78350F]">{order.recipient_details?.name || '-'}</p>
                            <p className="text-sm text-[#92400E]">{order.recipient_details?.phone || '-'}</p>
                            <p className="text-sm text-[#A16207]">{order.recipient_details?.address || '-'}</p>
                            <p className="text-sm text-[#A16207]">{recipientEmail}</p>
                          </div>
                        </div>

                        {/* Items */}
                        <div className="rounded-xl border border-[#E7ECEA] p-4">
                          <p className="text-sm font-black text-[#1B4332] mb-3 flex items-center gap-1">
                            <Package className="w-4 h-4" /> تفاصيل الأصناف ({allItems.length})
                          </p>
                          <div className="space-y-2">
                            {allItems.map((item, i) => {
                              if (i === 0) console.log('🔎 Raw item data for order', order.order_number, ':', JSON.stringify(item));
                              const qty = getItemQty(item);
                              const unitUSD = getItemUnitUSD(item);
                              const unitSYP = unitUSD > 0 ? unitUSD * exchangeRate : Number(item?.priceSYP || item?.customer_price || item?.price_syp || 0);
                              const imageUrl = getItemImageUrl(item);
                              return (
                                <div key={`${order.id}-item-${i}`} className="flex items-center gap-3 rounded-xl bg-[#FAFCFB] border border-[#E7ECEA] p-3">
                                  {imageUrl ? (
                                    <img src={imageUrl} alt={getItemName(item, i)} className="h-14 w-14 rounded-lg object-cover border border-[#E5E7EB] shrink-0" />
                                  ) : (
                                    <div className="h-14 w-14 rounded-lg bg-[#F1F5F9] border border-[#E5E7EB] flex items-center justify-center shrink-0">
                                      <ImageIcon className="w-5 h-5 text-[#94A3B8]" />
                                    </div>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-[#1B4332] truncate">{getItemName(item, i)}</p>
                                    <p className="text-xs text-[#64748B]">الكمية: {qty}</p>
                                  </div>
                                  <div className="text-left shrink-0">
                                    <p className="text-xs font-bold text-[#059669]">${(unitUSD > 0 ? unitUSD : unitSYP / exchangeRate).toFixed(2)}</p>
                                    <p className="text-xs text-[#64748B]">{Math.round(unitSYP > 0 ? unitSYP : unitUSD * exchangeRate).toLocaleString('en-US')} ل.س</p>
                                  </div>
                                </div>
                              );
                            })}
                            {allItems.length === 0 && <p className="text-xs text-[#94A3B8]">لا توجد أصناف مفصلة لهذا الطلب.</p>}
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* Assignment & Status controls */}
                    <div className="border-t border-[#E7ECEA] p-5">
                      <div className="grid gap-3 lg:grid-cols-3">
                        <div className="rounded-xl bg-[#FAFCFB] border border-[#E7ECEA] p-3">
                          <p className="text-xs text-[#64748B] mb-2">تحديث حالة الطلب</p>
                          <div className="flex items-center gap-2">
                            <select value={normalizedStatus}
                              onChange={(e) => handleUpdateStatus(order.id, e.target.value)}
                              disabled={updatingStatusForOrder === order.id}
                              className="flex-1 rounded-xl border border-[#E5E7EB] bg-white px-2 py-2 text-sm focus:border-[#1B4332] focus:outline-none">
                              {STATUS_OPTIONS.map((s) => <option key={`${order.id}-${s}`} value={s}>{STATUS_LABELS_AR[s] || s}</option>)}
                            </select>
                            {updatingStatusForOrder === order.id && <Loader2 className="w-4 h-4 animate-spin text-[#64748B]" />}
                          </div>
                        </div>

                        {/* وقت التوصيل المتوقع */}
                        <div className="rounded-xl bg-[#FAFCFB] border border-[#E7ECEA] p-3">
                          <p className="text-xs text-[#64748B] mb-2">وقت التوصيل المتوقع</p>
                          {order.delivery_time && (
                            <p className="text-xs text-[#059669] font-bold mb-2">الحالي: {order.delivery_time}</p>
                          )}
                          <div className="flex flex-col gap-2">
                            <input type="date"
                              value={deliveryTimeByOrder[order.id]?.date || ''}
                              onChange={(e) => setDeliveryTimeByOrder((prev) => ({ ...prev, [order.id]: { ...prev[order.id], date: e.target.value } }))}
                              className="w-full rounded-xl border border-[#E5E7EB] bg-white px-2 py-2 text-sm focus:border-[#1B4332] focus:outline-none" />
                            <input type="time"
                              value={deliveryTimeByOrder[order.id]?.time || ''}
                              onChange={(e) => setDeliveryTimeByOrder((prev) => ({ ...prev, [order.id]: { ...prev[order.id], time: e.target.value } }))}
                              className="w-full rounded-xl border border-[#E5E7EB] bg-white px-2 py-2 text-sm focus:border-[#1B4332] focus:outline-none" />
                            <Button onClick={() => handleSaveDeliveryTime(order.id)}
                              disabled={savingDeliveryTime === order.id}
                              className="rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-sm w-full">
                              {savingDeliveryTime === order.id ? 'جارٍ الحفظ...' : 'حفظ وقت التوصيل'}
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-xl bg-[#FAFCFB] border border-[#E7ECEA] p-3 lg:col-span-2">
                          <p className="text-xs text-[#64748B] mb-2">فرز الطلب إلى موصل</p>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <select value={selectedCourierValue}
                              onChange={(e) => setSelectedCourierByOrder((prev) => ({ ...prev, [order.id]: e.target.value }))}
                              className="flex-1 rounded-xl border border-[#E5E7EB] bg-white px-2 py-2 text-sm focus:border-[#1B4332] focus:outline-none">
                              <option value="">اختر موصل</option>
                              {couriers.map((c) => <option key={c.id} value={c.id}>{c.full_name || c.email || c.id}</option>)}
                            </select>
                            <Button onClick={() => handleAssignOrder(order)} disabled={assigningOrderId === order.id}
                              className="rounded-xl bg-[#1B4332] hover:bg-[#2D6A4F] text-white text-sm">
                              {assigningOrderId === order.id ? 'جارٍ...' : (assignment?.id ? 'تبديل + إشعار' : 'فرز + إشعار')}
                            </Button>
                            <Button onClick={() => handleUnassignOrder(order)}
                              disabled={assigningOrderId === order.id || !assignment?.id}
                              variant="outline"
                              className="rounded-xl border-red-300 text-red-600 hover:bg-red-50 text-sm">
                              إلغاء الفرز
                            </Button>
                          </div>
                          {assignment?.delivery_person_id && (
                            <p className="text-xs text-[#94A3B8] mt-2">
                              مفرز إلى: {couriers.find((c) => c.id === assignment.delivery_person_id)?.full_name || assignment.delivery_person_id}
                              {' '}({assignment.status || 'assigned'})
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.article>
                );
              })}

              {filteredOrders.length === 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="rounded-3xl border-2 border-dashed border-[#D1D5DB] bg-white p-10 text-center">
                  <ClipboardList className="w-12 h-12 mx-auto text-[#CBD5E1] mb-3" />
                  <p className="text-[#64748B] font-bold">لا توجد طلبات مطابقة</p>
                </motion.div>
              )}
            </section>
          </>
        )}

        {/* Couriers Section */}
        {activeSection === 'couriers' && (
          <section className="rounded-3xl border border-[#E7ECEA] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h2 className="text-xl font-black text-[#1B4332]">الموصلون وتفاصيلهم</h2>
              <Badge className="bg-[#ECFDF5] text-[#059669] border-0">{couriers.length} موصل</Badge>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {couriers.map((courier) => (
                <motion.article key={courier.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-[#E7ECEA] bg-[#FAFCFB] p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-[#1B4332] flex items-center justify-center shrink-0">
                      <User className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-black text-[#1B4332] truncate">{courier.full_name || 'بدون اسم'}</h3>
                      <p className="text-xs text-[#64748B] truncate">{courier.email || 'بدون بريد'}</p>
                    </div>
                  </div>
                  <div className="space-y-1 text-xs text-[#64748B]">
                    <p>المركبة: <span className="font-bold text-[#1B4332]">{courier.vehicle_type || 'غير محدد'}</span></p>
                    <p>الهاتف: <span className="font-bold text-[#1B4332]">{courier.phone || '-'}</span></p>
                    <p>الموقع: <span className="font-bold text-[#1B4332]">{courier.current_location || 'غير متوفر'}</span></p>
                    <p>الإعداد: <span className="font-bold text-[#1B4332]">{courier.onboarding_completed ? 'مكتمل' : 'غير مكتمل'}</span></p>
                    <p>دورة الراتب: <span className="font-bold text-[#1B4332]">{courier.payout_cycle === 'monthly' ? 'شهرية' : 'أسبوعية'}</span></p>
                    <p>طلبات مكتملة: <span className="font-bold text-[#1B4332]">{Number(courier.completed_orders_count || 0)}</span></p>
                    <p>الرصيد: <span className="font-bold text-[#065F46]">${Number(courier.balance_usd || 0).toFixed(2)} / {Math.round(Number(courier.balance_syp || 0)).toLocaleString('en-US')} ل.س</span></p>
                    <p>الحالة: <Badge className={`text-xs border-0 ${courier.is_available === false ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'}`}>
                      {courier.is_available === false ? 'غير متاح' : 'متاح'}
                    </Badge></p>
                  </div>

                  <Button
                    onClick={() => handleResetCourierBalance(courier)}
                    disabled={resettingCourierId === courier.id || !courier.onboarding_completed}
                    variant="outline"
                    className="w-full mt-3 rounded-xl border-amber-300 text-amber-700 hover:bg-amber-50 text-xs"
                  >
                    {resettingCourierId === courier.id ? 'جارٍ التصفير...' : 'تصفير الرصيد بعد التسديد'}
                  </Button>
                </motion.article>
              ))}
            </div>
            {couriers.length === 0 && <p className="text-sm text-[#94A3B8] mt-3">لا يوجد موصلون ظاهرون.</p>}
          </section>
        )}

        {/* Wasel+ Memberships Section */}
        {activeSection === 'memberships' && (
          <section className="rounded-3xl border border-[#E7ECEA] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h2 className="text-xl font-black text-[#1B4332]">اشتراكات Wasel+</h2>
              <Badge className="bg-[#FEF3C7] text-[#92400E] border-0">{memberships.length} اشتراك</Badge>
            </div>
            {memberships.length === 0 ? (
              <div className="text-center py-8 text-[#94A3B8]">
                <Crown className="w-10 h-10 mx-auto mb-2 text-[#CBD5E1]" />
                <p>لا توجد اشتراكات بعد</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {memberships.map((m) => {
                  const isPending = m.status === 'pending_whatsapp';
                  const isActive = m.status === 'active' || m.status === 'trialing';
                  const rowKey = m.id || m.user_email;
                  const startDateValue = membershipEdits[rowKey]?.start_date ?? toDateInputValue(m.start_date);
                  const endDateValue = membershipEdits[rowKey]?.end_date ?? toDateInputValue(m.end_date);
                  return (
                    <motion.article key={m.id || m.user_email} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      className={`rounded-2xl border p-4 ${isPending ? 'border-amber-300 bg-amber-50' : isActive ? 'border-emerald-300 bg-emerald-50' : 'border-[#E7ECEA] bg-[#FAFCFB]'}`}>
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isActive ? 'bg-emerald-600' : isPending ? 'bg-amber-500' : 'bg-gray-400'}`}>
                          <Crown className="w-5 h-5 text-white" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-black text-[#1B4332] truncate text-sm">{m.user_email || 'بدون بريد'}</h3>
                          <Badge className={`text-xs border-0 ${isActive ? 'bg-emerald-100 text-emerald-700' : isPending ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                            {isActive ? 'مفعّل' : isPending ? 'بانتظار التفعيل' : m.status}
                          </Badge>
                        </div>
                      </div>
                      <div className="space-y-1 text-xs text-[#64748B]" dir="rtl">
                        <p>الخطة: <span className="font-bold text-[#1B4332]">{m.plan_type === 'yearly' ? 'سنوية' : 'شهرية'} - ${m.price_usd}</span></p>
                        <p>الدفع: <span className="font-bold text-[#1B4332]">{m.payment_method === 'whatsapp' ? 'واتساب' : 'PayPal'}</span></p>
                        {m.subscription_code && (
                          <p>الكود: <span className="font-mono font-bold text-[#1B4332] tracking-wider">{m.subscription_code}</span></p>
                        )}
                        {m.start_date && <p>البداية: <span className="font-bold text-[#1B4332]">{new Date(m.start_date).toLocaleDateString('ar-EG')}</span></p>}
                        {m.end_date && <p>الانتهاء: <span className="font-bold text-[#1B4332]">{new Date(m.end_date).toLocaleDateString('ar-EG')}</span></p>}
                        <p>آخر تحديث: <span className="font-bold text-[#1B4332]">{new Date(m.updated_at || m.created_at).toLocaleDateString('ar-EG')}</span></p>
                      </div>
                      {isPending && (
                        <Button onClick={() => handleActivateMembership(m)}
                          disabled={activatingMembership === (m.id || m.user_email)}
                          className="w-full mt-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm">
                          {activatingMembership === (m.id || m.user_email) ? 'جارٍ التفعيل...' : 'تفعيل الاشتراك'}
                        </Button>
                      )}

                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="date"
                          value={startDateValue}
                          onChange={(e) => handleMembershipEditChange(m, 'start_date', e.target.value)}
                          className="rounded-xl border border-[#E5E7EB] bg-white px-2 py-2 text-xs focus:border-[#1B4332] focus:outline-none"
                        />
                        <input
                          type="date"
                          value={endDateValue}
                          onChange={(e) => handleMembershipEditChange(m, 'end_date', e.target.value)}
                          className="rounded-xl border border-[#E5E7EB] bg-white px-2 py-2 text-xs focus:border-[#1B4332] focus:outline-none"
                        />
                      </div>

                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Button
                          onClick={() => handleSaveMembershipDates(m)}
                          disabled={savingMembershipId === rowKey}
                          variant="outline"
                          className="rounded-xl border-[#1B4332]/20 text-[#1B4332] text-xs"
                        >
                          {savingMembershipId === rowKey ? 'جارٍ الحفظ...' : 'تحديث التواريخ'}
                        </Button>
                        <Button
                          onClick={() => handleCancelMembership(m)}
                          disabled={savingMembershipId === rowKey || m.status === 'cancelled'}
                          variant="outline"
                          className="rounded-xl border-red-300 text-red-600 hover:bg-red-50 text-xs"
                        >
                          {m.status === 'cancelled' ? 'ملغي' : 'إلغاء العضوية'}
                        </Button>
                      </div>
                    </motion.article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Reviews Section */}
        {activeSection === 'reviews' && (
          <section className="rounded-3xl border border-[#E7ECEA] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h2 className="text-xl font-black text-[#1B4332]">تقييمات العملاء</h2>
              <Badge className="bg-[#FEF3C7] text-[#92400E] border-0">{reviewsFeedback.length} تقييم</Badge>
            </div>

            {reviewsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-[#1B4332]" /></div>
            ) : reviewsFeedback.length === 0 ? (
              <div className="text-center py-8 text-[#94A3B8]">
                <Star className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>لا يوجد تقييمات بعد</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Summary Cards */}
                {(() => {
                  const total = reviewsFeedback.length;
                  const avgOverall = total ? (reviewsFeedback.reduce((s, r) => s + Number(r.overall_rating || 0), 0) / total).toFixed(1) : '0';
                  const avgProduct = total ? (reviewsFeedback.reduce((s, r) => s + Number(r.product_quality_rating || 0), 0) / total).toFixed(1) : '0';
                  const avgService = total ? (reviewsFeedback.reduce((s, r) => s + Number(r.support_rating || 0), 0) / total).toFixed(1) : '0';
                  const stars = [5, 4, 3, 2, 1].map(s => ({
                    star: s,
                    count: reviewsFeedback.filter(r => Math.round(Number(r.overall_rating || 0)) === s).length,
                  }));
                  return (
                    <>
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="bg-yellow-50 rounded-2xl p-4 text-center">
                          <p className="text-2xl font-black text-yellow-600">{avgOverall}</p>
                          <p className="text-xs text-gray-500">التقييم العام</p>
                          <div className="flex justify-center mt-1">
                            {[1, 2, 3, 4, 5].map(s => (
                              <Star key={s} className={`w-3 h-3 ${s <= Math.round(Number(avgOverall)) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />
                            ))}
                          </div>
                        </div>
                        <div className="bg-green-50 rounded-2xl p-4 text-center">
                          <p className="text-2xl font-black text-green-600">{avgProduct}</p>
                          <p className="text-xs text-gray-500">جودة المنتجات</p>
                        </div>
                        <div className="bg-blue-50 rounded-2xl p-4 text-center">
                          <p className="text-2xl font-black text-blue-600">{avgService}</p>
                          <p className="text-xs text-gray-500">جودة الخدمة</p>
                        </div>
                      </div>

                      {/* Star Distribution */}
                      <div className="bg-gray-50 rounded-2xl p-4 mb-4">
                        <h4 className="text-sm font-bold text-[#1B4332] mb-2">توزيع التقييمات</h4>
                        {stars.map(({ star, count }) => (
                          <div key={star} className="flex items-center gap-2 mb-1">
                            <span className="text-xs w-4 text-gray-500">{star}</span>
                            <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-yellow-400 rounded-full transition-all"
                                style={{ width: `${total ? (count / total * 100) : 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 w-8 text-left">{count}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()}

                {/* Individual Reviews */}
                {reviewsFeedback.map((fb, idx) => {
                  const orderNum = fb.orders?.order_number || fb.order_id?.slice(0, 8) || '-';
                  const recipientName = fb.orders?.recipient_details?.name || '-';
                  const itemRatings = fb.metadata?.item_ratings || [];
                  return (
                    <motion.article key={fb.id || idx} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.03 }}
                      className="rounded-2xl border border-[#E7ECEA] bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-sm font-bold text-[#1B4332]">طلب #{orderNum}</p>
                          <p className="text-xs text-[#64748B]">{recipientName}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map(s => (
                            <Star key={s} className={`w-4 h-4 ${s <= Math.round(Number(fb.overall_rating || 0)) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />
                          ))}
                        </div>
                      </div>

                      {/* Per-product ratings */}
                      {itemRatings.length > 0 && (
                        <div className="bg-gray-50 rounded-xl p-2 mb-2 space-y-1">
                          {itemRatings.map((ir, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <span className="text-gray-600 truncate flex-1">{ir.item_id?.slice(0, 8) || `منتج ${i + 1}`}</span>
                              <div className="flex items-center gap-0.5">
                                {[1, 2, 3, 4, 5].map(s => (
                                  <Star key={s} className={`w-3 h-3 ${s <= ir.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {fb.comment && (
                        <p className="text-xs text-[#64748B] bg-gray-50 rounded-xl p-2 leading-relaxed">{fb.comment}</p>
                      )}

                      <p className="text-[10px] text-[#94A3B8] mt-2">
                        {fb.created_at ? new Date(fb.created_at).toLocaleString('ar-SY') : ''}
                      </p>
                    </motion.article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Messages Section */}
        {activeSection === 'messages' && (
          <section className="rounded-3xl border border-[#E7ECEA] bg-white shadow-sm overflow-hidden" style={{ minHeight: '60vh' }}>
            <div className="flex items-center justify-between gap-2 p-5 border-b border-[#E7ECEA]">
              <h2 className="text-xl font-black text-[#1B4332]">الرسائل والمحادثات</h2>
              <Badge className="bg-[#EFF6FF] text-[#2563EB] border-0">{conversations.length} محادثة</Badge>
            </div>

            {conversationsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-[#1B4332]" /></div>
            ) : activeConversation ? (
              /* Chat View */
              <div className="flex flex-col" style={{ height: '55vh' }}>
                {/* Chat Header */}
                <div className="flex items-center gap-3 px-5 py-3 border-b border-[#E7ECEA] bg-[#F8FAFB]">
                  <button
                    onClick={() => { setActiveConversation(null); setChatMessages([]); }}
                    className="text-[#1B4332] hover:bg-[#E7ECEA] rounded-full p-1"
                  >
                    <ChevronUp className="w-5 h-5 rotate-90" />
                  </button>
                  <div>
                    <p className="text-sm font-bold text-[#1B4332]">
                      {activeConversation.type === 'courier_supervisor'
                        ? '💬 محادثة موصل'
                        : '🎧 دعم عميل'}
                    </p>
                    <p className="text-xs text-[#64748B]">{activeConversation.id?.slice(0, 20)}</p>
                  </div>
                </div>

                {/* Chat Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {chatMessages.length === 0 ? (
                    <p className="text-center text-sm text-[#94A3B8] mt-8">لا توجد رسائل بعد</p>
                  ) : chatMessages.map((msg, idx) => {
                    const isMine = msg.sender_role === 'supervisor' || msg.sender_id === currentUser?.id;
                    return (
                      <div key={msg.id || idx} className={`flex ${isMine ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                          isMine
                            ? 'bg-[#1B4332] text-white rounded-bl-sm'
                            : 'bg-[#E7ECEA] text-[#1B4332] rounded-br-sm'
                        }`}>
                          {!isMine && (
                            <p className="text-[10px] font-bold mb-0.5 opacity-70">{msg.sender_name || 'مستخدم'}</p>
                          )}
                          <p className="text-sm leading-relaxed">{msg.message}</p>
                          {msg.attachment_url && (
                            <a href={msg.attachment_url} target="_blank" rel="noopener" className="text-xs underline mt-1 block opacity-80">📎 مرفق</a>
                          )}
                          <p className={`text-[10px] mt-1 ${isMine ? 'text-green-200' : 'text-gray-400'}`}>
                            {msg.created_at ? new Date(msg.created_at).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' }) : ''}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Chat Input */}
                <div className="flex items-center gap-2 px-4 py-3 border-t border-[#E7ECEA] bg-[#F8FAFB]">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendChatMessage()}
                    placeholder="اكتب رسالة..."
                    className="flex-1 rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm focus:border-[#1B4332] focus:outline-none"
                    dir="rtl"
                  />
                  <Button
                    onClick={sendChatMessage}
                    disabled={!chatInput.trim() || sendingChat}
                    className="rounded-xl bg-[#1B4332] hover:bg-[#2D6A4F] text-white h-10 w-10 p-0"
                  >
                    {sendingChat ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-12 text-[#94A3B8]">
                <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>لا توجد محادثات بعد</p>
                <p className="text-xs mt-1">ستظهر المحادثات عندما يتواصل معك الموصلون أو العملاء</p>
              </div>
            ) : (
              /* Conversations List */
              <div className="divide-y divide-[#E7ECEA]">
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => openConversation(conv)}
                    className="w-full flex items-center gap-3 px-5 py-4 hover:bg-[#F8FAFB] transition-colors text-right"
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      conv.type === 'courier_supervisor' ? 'bg-[#ECFDF5]' : 'bg-[#EFF6FF]'
                    }`}>
                      {conv.type === 'courier_supervisor'
                        ? <Truck className="w-5 h-5 text-[#059669]" />
                        : <User className="w-5 h-5 text-[#2563EB]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-[#1B4332] truncate">
                        {conv.type === 'courier_supervisor' ? 'محادثة موصل' : 'دعم عميل'}
                      </p>
                      <p className="text-xs text-[#64748B] truncate">{conv.last_message || 'لا توجد رسائل'}</p>
                    </div>
                    <div className="text-[10px] text-[#94A3B8] flex-shrink-0">
                      {conv.last_message_at ? new Date(conv.last_message_at).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' }) : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Wallets Section */}
        {activeSection === 'wallets' && (
          <section className="rounded-3xl border border-[#E7ECEA] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h2 className="text-xl font-black text-[#1B4332]">محافظ المستخدمين</h2>
              <Badge className="bg-[#ECFDF5] text-[#059669] border-0">{systemWallets.length} محفظة</Badge>
            </div>
            {systemWallets.length === 0 ? (
              <div className="text-center py-8 text-[#94A3B8]">
                <BookOpen className="w-10 h-10 mx-auto mb-2 text-[#CBD5E1]" />
                <p>لا توجد محافظ بعد</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {systemWallets.map((w) => (
                  <motion.article key={w.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-[#E7ECEA] bg-[#FAFCFB] p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1B4332] to-[#40916C] flex items-center justify-center shrink-0">
                        <User className="w-5 h-5 text-white" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-black text-[#1B4332] truncate text-sm">{w.user?.full_name || 'بدون اسم'}</h3>
                        <p className="text-xs text-[#64748B] truncate">{w.user?.email || 'بدون إيميل'}</p>
                      </div>
                    </div>
                    <div className="space-y-1 text-sm text-[#64748B] mb-3">
                      <p>الرصيد الكلي: <span className="font-black text-[#059669]">${Number(w.balance_usd || 0).toFixed(2)}</span> / <span className="text-[#059669]">{Math.round(Number(w.balance_usd || 0) * exchangeRate).toLocaleString('en-US')} ل.س</span></p>
                      <p className="text-xs">آخر تحديث: <span className="font-bold text-[#1B4332]">{new Date(w.updated_at || w.created_at).toLocaleDateString('ar-EG')}</span></p>
                    </div>
                    <Button onClick={() => handleResetWallet(w.id, Number(w.balance_usd || 0), w.user_id)}
                      disabled={resettingWalletId === w.id || Number(w.balance_usd || 0) <= 0}
                      variant="outline"
                      className="w-full rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700">
                      {resettingWalletId === w.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                      تصفير الرصيد
                    </Button>
                  </motion.article>
                ))}
              </div>
            )}
          </section>
        )}

        {/* User Control Section */}
        {activeSection === 'user-control' && (
          <section className="rounded-3xl border border-[#E7ECEA] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h2 className="text-xl font-black text-[#1B4332]">إدارة محافظ المستخدمين</h2>
              <Badge className="bg-[#ECFDF5] text-[#059669] border-0">{users.length} مستخدم</Badge>
            </div>

            {/* Search Bar */}
            <div className="mb-5">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#94A3B8]" />
                <input
                  type="text"
                  placeholder="ابحث عن المستخدم بالاسم أو البريد..."
                  value={usersSearch}
                  onChange={(e) => setUsersSearch(e.target.value)}
                  className="w-full border border-[#E5E7EB] rounded-xl pl-4 pr-10 py-2.5 focus:border-[#1B4332] focus:outline-none"
                />
              </div>
            </div>

            {loadingUsers ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-[#1B4332]" />
              </div>
            ) : users.length === 0 ? (
              <div className="text-center py-8 text-[#94A3B8]">
                <Users className="w-10 h-10 mx-auto mb-2 text-[#CBD5E1]" />
                <p>لا توجد بيانات مستخدمين</p>
              </div>
            ) : (
              <div className="space-y-3">
                {users
                  .filter(user =>
                    usersSearch === '' ||
                    String(user.full_name || '').toLowerCase().includes(usersSearch.toLowerCase()) ||
                    String(user.email || '').toLowerCase().includes(usersSearch.toLowerCase())
                  )
                  .map((user) => (
                    <motion.article
                      key={user.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-2xl border border-[#E7ECEA] bg-[#FAFCFB] p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        {/* User Info */}
                        <div className="flex items-start gap-3 flex-1">
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#1B4332] to-[#40916C] flex items-center justify-center shrink-0">
                            <User className="w-6 h-6 text-white" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="font-black text-[#1B4332] truncate">{user.full_name || 'بدون اسم'}</h3>
                            <p className="text-xs text-[#64748B] truncate">{user.email || 'بدون إيميل'}</p>
                            {user.phone && <p className="text-xs text-[#64748B]">{user.phone}</p>}
                            <Badge className="mt-1 bg-blue-100 text-blue-700 border-0 text-xs">{user.role || 'مستخدم'}</Badge>
                          </div>
                        </div>

                        {/* Select Button */}
                        <Button
                          onClick={() => {
                            setSelectedUserForWallet(selectedUserForWallet?.id === user.id ? null : user);
                            setWalletAmountToAdd('');
                            setWalletAmountToReduce('');
                          }}
                          variant={selectedUserForWallet?.id === user.id ? 'default' : 'outline'}
                          className={`rounded-xl shrink-0 ${
                            selectedUserForWallet?.id === user.id
                              ? 'bg-[#1B4332] hover:bg-[#2D6A4F] text-white'
                              : 'border-[#1B4332]/20 text-[#1B4332]'
                          }`}
                        >
                          {selectedUserForWallet?.id === user.id ? 'تم التحديد' : 'اختيار'}
                        </Button>
                      </div>

                      {/* Wallet Control Panel */}
                      {selectedUserForWallet?.id === user.id && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-4 pt-4 border-t border-[#E7ECEA] space-y-3"
                        >
                          <div className="grid gap-3 sm:grid-cols-2">
                            {/* Add Amount */}
                            <div>
                              <label className="block text-xs font-bold text-[#1B4332] mb-1">إضافة رصيد ($)</label>
                              <div className="flex gap-2">
                                <input
                                  type="number"
                                  placeholder="0.00"
                                  value={walletAmountToAdd}
                                  onChange={(e) => setWalletAmountToAdd(e.target.value)}
                                  className="flex-1 border border-[#E5E7EB] rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                                  step="0.01"
                                  min="0"
                                />
                                <Button
                                  onClick={() => updateUserWallet(user.id, walletAmountToAdd, 'add')}
                                  disabled={updatingUserWallet === user.id || !walletAmountToAdd}
                                  className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3"
                                >
                                  {updatingUserWallet === user.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Plus className="w-4 h-4" />
                                  )}
                                </Button>
                              </div>
                            </div>

                            {/* Reduce Amount */}
                            <div>
                              <label className="block text-xs font-bold text-[#1B4332] mb-1">خصم رصيد ($)</label>
                              <div className="flex gap-2">
                                <input
                                  type="number"
                                  placeholder="0.00"
                                  value={walletAmountToReduce}
                                  onChange={(e) => setWalletAmountToReduce(e.target.value)}
                                  className="flex-1 border border-[#E5E7EB] rounded-xl px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
                                  step="0.01"
                                  min="0"
                                />
                                <Button
                                  onClick={() => updateUserWallet(user.id, walletAmountToReduce, 'reduce')}
                                  disabled={updatingUserWallet === user.id || !walletAmountToReduce}
                                  className="rounded-xl bg-red-600 hover:bg-red-700 text-white px-3"
                                >
                                  {updatingUserWallet === user.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Minus className="w-4 h-4" />
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                          <p className="text-xs text-[#94A3B8]">
                            💡 عملیات التعديل تُحفظ تلقائياً وتُسجَّل في سجل الحركات
                          </p>
                        </motion.div>
                      )}
                    </motion.article>
                  ))}
              </div>
            )}
          </section>
        )}

        {/* Controls Section */}
        {activeSection === 'controls' && (
          <section className="grid gap-4 md:grid-cols-2">
            <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-3xl border border-[#E7ECEA] bg-white p-5 shadow-sm">
              <h3 className="text-lg font-black text-[#1B4332] mb-3">أدوات الإدارة</h3>
              <div className="space-y-2">
                <Button onClick={() => navigate(createPageUrl('Home'))} variant="outline" className="w-full rounded-xl border-[#1B4332]/20 text-[#1B4332]">واجهة العملاء</Button>
                <Button onClick={() => navigate(createPageUrl('DriverPanel'))} variant="outline" className="w-full rounded-xl border-[#1B4332]/20 text-[#1B4332]">لوحة الموصل</Button>
                <Button onClick={() => setActiveSection('orders')} className="w-full rounded-xl bg-[#1B4332] hover:bg-[#2D6A4F] text-white">إدارة الطلبات الآن</Button>
              </div>
            </motion.article>

            <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="rounded-3xl border border-[#E7ECEA] bg-white p-5 shadow-sm">
              <h3 className="text-lg font-black text-[#1B4332] mb-3">معلومات المنصة</h3>
              <div className="space-y-2 text-sm text-[#64748B]">
                <p>اسم المشرف: <span className="font-bold text-[#1B4332]">{currentUser?.name || '-'}</span></p>
                <p>البريد: <span className="font-bold text-[#1B4332]">{currentUser?.email || '-'}</span></p>
                <p>الدور: <span className="font-bold text-[#1B4332]">{currentUser?.role || '-'}</span></p>
                <p>الموصلون المتاحون: <span className="font-bold text-[#1B4332]">{activeCouriersCount}</span></p>
              </div>

              <div className="mt-4 pt-4 border-t border-[#E7ECEA]">
                <p className="text-sm font-black text-[#1B4332] mb-2">سعر الصرف (USD/SYP)</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={exchangeRateInput}
                    onChange={(e) => setExchangeRateInput(normalizeDecimalInput(e.target.value))}
                    className="flex-1 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:border-[#1B4332] focus:outline-none"
                  />
                  <Button
                    onClick={handleUpdateExchangeRate}
                    disabled={savingExchangeRate}
                    className="rounded-xl bg-[#1B4332] hover:bg-[#2D6A4F] text-white"
                  >
                    {savingExchangeRate ? 'جارٍ الحفظ...' : 'تحديث'}
                  </Button>
                </div>
                <p className="text-xs text-[#64748B] mt-2">السعر الحالي: {exchangeRateInput} ل.س لكل 1$</p>
              </div>
            </motion.article>
          </section>
        )}
      </main>
    </div>
  );
}

