// =====================================================
// WASEL - CART PAGE (Noon-Style High Conversion Design)
// File: src/pages/Cart.jsx
import AppFooter from '@/components/common/AppFooter';
// =====================================================

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCart } from '@/components/cart/CartContext';
import { 
  Minus, Plus, Trash2, ShoppingBag, ArrowRight, Tag,
  Truck, Gift, CreditCard, ChevronLeft,
  Heart, Sparkles, CheckCircle, X, Loader2, Edit3,
  Phone, Shield, MessageCircle, Eye, FileDown, Share2, Copy, Wallet, Bell
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import PayPalPayment from '@/components/payment/PayPalPayment';
import PayPalModal from '@/components/payment/PayPalModal';
import EnvelopeGift from '@/components/cart/EnvelopeGift';
import { getCountriesArabicNames, getCountryByArabicName, getCallingCode } from '@/utils/countryData';
import {
  getSavedSenderInfo,
  getSavedReceiverInfo,
  saveSenderInfo,
  saveReceiverInfo,
  getSelectedAddress,
  saveAddressFromRecipient,
} from '@/utils/senderReceiverStorage';
import { supabase } from '@/lib/supabase';
import { useUsdToSypRate } from '@/lib/exchangeRate';
import { interleaveByCategory, scoreItemsByBehavior } from '@/lib/recommendationSignals';
import { getUserRegion, isInsideSyria } from '@/lib/userRegion';
import { notifyAdminUsers } from '@/services/firebaseOrderNotifications';
import { buildPublicAppUrl } from '@/lib/publicAppUrl';
import SmartLottie from '@/components/animations/SmartLottie';
import { ANIMATION_PRESETS } from '@/components/animations/animationPresets';
import {
  validatePaymentBeforeOrder,
  validateWalletPayment,
  validateAmountMatch,
  validateOrderNotModified,
  checkDuplicateOrder,
  markOrderCreated,
  logSuspiciousPaymentAttempt,
} from '@/lib/paymentSecurity';

// =====================================================
// CONSTANTS
// =====================================================
const PRIMARY_COLOR = '#C2185B';
const EXCHANGE_RATE = 150; // 1 USD = 150 SYP (سعر الصرف الصحيح)
const FREE_DELIVERY_THRESHOLD_SYP = 2000; // 2000 ل.س للتوصيل المجاني
const MARKUP_FACTOR = 1.20; // 20% markup for phantom discount
const FAKE_DELIVERY_FEE_SYP = 300; // 300 ل.س رسوم التوصيل
const WHATSAPP_NUMBER = '971502406519'; // رقم الواتساب
const WHATSAPP_BASE_LINK = `https://wa.me/${WHATSAPP_NUMBER}`;

// Tip Options - بالليرة السورية (10, 30, 60)
const TIP_OPTIONS = [
  { valueSYP: 10, label: '10', emoji: '🥤' },
  { valueSYP: 30, label: '30', emoji: '😊', popular: true },
  { valueSYP: 60, label: '60', emoji: '🎉' },
  { valueSYP: 'custom', label: 'تخصيص', emoji: '✏️' },
];

const PAYPAL_PENDING_ORDERS_KEY = 'wasel_paypal_pending_orders_v1';
const PAYPAL_SAVED_CAPTURES_KEY = 'wasel_paypal_saved_captures_v1';
const MAX_PAYPAL_SAVE_RETRIES = 3;
const WASEL_PLUS_STATUSES = ['active', 'trialing'];

function isMissingRpcFunctionError(error, functionName) {
  const haystack = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
    error?.name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const fn = String(functionName || '').toLowerCase();
  return (
    !!fn &&
    haystack.includes(fn) &&
    (
      haystack.includes('schema cache') ||
      haystack.includes('not found') ||
      haystack.includes('does not exist') ||
      haystack.includes('404')
    )
  );
}

const normalizeCategory = (value) => String(value || '').toLowerCase();

function getMembershipDiscountRate(item) {
  const itemType = normalizeCategory(item?.item_type);
  const category = normalizeCategory(item?.category);
  const sourceType = normalizeCategory(item?.source_type || item?.type);

  if (itemType === 'gift' || itemType === 'package') return 0.2;

  if (
    category.includes('gift') ||
    category.includes('باقة') ||
    category.includes('هد') ||
    sourceType.includes('gift') ||
    sourceType.includes('package')
  ) {
    return 0.2;
  }

  if (
    category.includes('supermarket') ||
    category.includes('market') ||
    category.includes('grocery') ||
    category.includes('سوبر')
  ) {
    return 0.2;
  }

  if (
    category.includes('restaurant') ||
    category.includes('menu') ||
    category.includes('food') ||
    category.includes('مطعم') ||
    sourceType.includes('menuitem')
  ) {
    return 0.1;
  }

  if (
    category.includes('electronic') ||
    category.includes('electronics') ||
    category.includes('الكترون')
  ) {
    return 0.1;
  }

  return 0;
}

// =====================================================
// EMPTY CART COMPONENT
// =====================================================
function EmptyCart({ onNavigate }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 200, damping: 20 }}
      className="flex flex-col items-center justify-center py-20 px-4"
    >
      <SmartLottie
        animationPath={ANIMATION_PRESETS.emptyCart.path}
        width={150}
        height={150}
        trigger="immediate"
      />
      <motion.h2 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-xl font-bold text-gray-900 mb-2 mt-4" 
        dir="rtl"
      >
        سلتك فارغة
      </motion.h2>
      <motion.p 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="text-gray-500 text-center max-w-xs mb-6" 
        dir="rtl"
      >
        ابدأ التسوق وأضف أطباقك المفضلة إلى السلة
      </motion.p>
      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onNavigate}
        className="inline-flex items-center gap-2 px-8 py-3 bg-[#C2185B] text-white rounded-xl font-bold hover:bg-[#A01550] transition-colors shadow-lg"
      >
        تصفح القائمة
        <ChevronLeft className="w-5 h-5" />
      </motion.button>
    </motion.div>
  );
}

// =====================================================
// PROGRESS BAR - FREE DELIVERY GAMIFICATION
// =====================================================
function FreeDeliveryProgress({ currentTotalSYP, thresholdSYP }) {
  const progress = Math.min((currentTotalSYP / thresholdSYP) * 100, 100);
  const remaining = Math.max(thresholdSYP - currentTotalSYP, 0);
  const isUnlocked = currentTotalSYP >= thresholdSYP;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-4 rounded-2xl mb-4 ${isUnlocked ? 'bg-green-50' : 'bg-yellow-50'}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Truck className={`w-5 h-5 ${isUnlocked ? 'text-green-600' : 'text-yellow-600'}`} />
          <span className={`font-bold text-sm ${isUnlocked ? 'text-green-700' : 'text-yellow-700'}`} dir="rtl">
            {isUnlocked ? 'مبروك! التوصيل مجاني 🎉' : `أضف بـ ${remaining.toLocaleString('en-US')} ل.س للتوصيل المجاني`}
          </span>
        </div>
        {!isUnlocked && (
          <span className="text-xs text-yellow-600 font-medium">
            {progress.toFixed(0)}%
          </span>
        )}
      </div>
      
      {/* Progress Bar */}
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className={`h-full rounded-full ${isUnlocked ? 'bg-green-500' : 'bg-[#C2185B]'}`}
        />
      </div>
    </motion.div>
  );
}

// =====================================================
// CART ITEM ROW - مع دعم الصور من Base44
// =====================================================
function CartItemRow({ item, onQuantityChange, onRemove, isUpdating, onViewDetails, exchangeRate = EXCHANGE_RATE }) {
  // السعر الأصلي من Base44 (customer_price بالليرة السورية)
  const originalPriceSYP = item.customer_price || item.price || 0;
  
  // السعر المعروض = السعر الأصلي × 1.20 (زيادة وهمية 20%)
  // ✅ للهدايا النقدية: استخدم السعر الأصلي بدقة
  let displayedPriceSYP = Math.round(originalPriceSYP * MARKUP_FACTOR);
  
  if (String(item.item_type || '').toLowerCase() === 'cash_gift') {
    // للهدايا: إذا كانت العملة الأصلية USD، تحويل صحيح
    if (item.original_currency === 'USD') {
      displayedPriceSYP = Math.round((item.original_amount || 0) * exchangeRate);
    } else {
      displayedPriceSYP = item.price || 0;
    }
  }
  
  const displayedPriceUSD = displayedPriceSYP / exchangeRate;
  
  // المجموع للعنصر (بالسعر المعروض)
  const totalDisplayedPriceSYP = displayedPriceSYP * (item.quantity || 1);
  const totalDisplayedPriceUSD = totalDisplayedPriceSYP / exchangeRate;

  // الحصول على رابط الصورة الصحيح مع أولوية image_url لتجنب اختلاف الصور
  const getImageUrl = () => {
    // أعطِ الأولوية لــ image_url إن وجدت
    if (item.image_url && typeof item.image_url === 'string' && item.image_url.trim()) {
      return item.image_url;
    }
    // ثم تحقق من image كسلسلة نصية
    if (item.image && typeof item.image === 'string' && item.image.startsWith('http')) {
      return item.image;
    }
    // ثم مصفوفات الصور
    if (item.images && Array.isArray(item.images) && item.images.length > 0) {
      const img = item.images[0];
      if (typeof img === 'string') return img;
      if (img?.url) return img.url;
    }
    if (item.image && Array.isArray(item.image) && item.image.length > 0) {
      const img = item.image[0];
      if (typeof img === 'string') return img;
      if (img?.url) return img.url;
    }
    // Fallback
    return 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&h=200&fit=crop';
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20, height: 0 }}
      whileHover={{ backgroundColor: '#fafafa' }}
      className="flex gap-3 p-3 bg-white border-b border-gray-100 transition-colors"
      dir="rtl"
    >
      {/* Image - قابلة للنقر لعرض التفاصيل */}
      <motion.div 
        className="w-[100px] h-[100px] rounded-xl overflow-hidden bg-gray-100 shrink-0 cursor-pointer relative group"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => onViewDetails?.(item)}
      >
        <img 
          src={getImageUrl()} 
          alt={item.name_ar || item.name}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => { 
            e.target.src = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&h=200&fit=crop'; 
          }}
        />
        {/* Overlay للنقر */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <Eye className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        {/* Badge الكمية */}
        {item.quantity > 1 && (
          <motion.div 
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute top-1 right-1 w-6 h-6 bg-[#C2185B] text-white rounded-full flex items-center justify-center text-xs font-bold shadow-md"
          >
            {item.quantity}
          </motion.div>
        )}
      </motion.div>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
        {/* Title + Gift Badge */}
        <div className="flex items-center gap-2">
          <h4 className="font-bold text-gray-900 text-base leading-tight line-clamp-1">
            {item.name_ar || item.name}
          </h4>
          {String(item.item_type || '').toLowerCase() === 'cash_gift' && (
            <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-bold rounded-full whitespace-nowrap">
              🎁 هدية مع السعر
            </span>
          )}
        </div>

        {/* Description */}
        {(item.description_ar || item.description) && (
          <p className="text-gray-500 text-xs line-clamp-2 mt-1">
            {item.description_ar || item.description}
          </p>
        )}

        {/* Price - السعر المعروض (مع الزيادة الوهمية) */}
        <div className="flex flex-col gap-1 mt-2">
          <div className="flex items-center gap-2">
            <p className="text-[#C2185B] font-bold">
              {displayedPriceSYP.toLocaleString('en-US')} ل.س
            </p>
            <span className="text-gray-400 text-xs mx-1">|</span>
            <span className="text-gray-500 text-xs">
              ${displayedPriceUSD.toFixed(2)}
            </span>
          </div>
          {item.quantity > 1 && (
            <span className="text-xs text-gray-600 font-medium">
              × {item.quantity} = {totalDisplayedPriceSYP.toLocaleString('en-US')} ل.س | ${totalDisplayedPriceUSD.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {/* Actions & Total */}
      <div className="flex flex-col items-end justify-between shrink-0">
        {/* Delete Button */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => onRemove(item.id)}
          disabled={isUpdating}
          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </motion.button>

        {/* Quantity Controls */}
        <div className="flex items-center bg-white rounded-full border border-[#C2185B]/30 overflow-hidden shadow-sm">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => onQuantityChange(item.id, item.quantity - 1)}
            disabled={isUpdating}
            className="w-8 h-8 flex items-center justify-center text-[#C2185B] hover:bg-[#C2185B]/10 transition-colors disabled:opacity-50"
          >
            <Minus className="w-4 h-4" />
          </motion.button>
          <motion.span 
            key={item.quantity}
            initial={{ scale: 1.2 }}
            animate={{ scale: 1 }}
            className="w-8 text-center font-bold text-[#C2185B] text-sm"
          >
            {item.quantity}
          </motion.span>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => onQuantityChange(item.id, item.quantity + 1)}
            disabled={isUpdating}
            className="w-8 h-8 flex items-center justify-center text-[#C2185B] hover:bg-[#C2185B]/10 transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

// =====================================================
// UPSELL CAROUSEL - جلب المنتجات من Base44
// =====================================================
function UpsellCarousel({ onAddItem }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const exchangeRate = useUsdToSypRate() || EXCHANGE_RATE;

  const normalizeUpsellItem = (item, itemType) => ({
    ...item,
    item_type: itemType,
    name: item?.name || item?.name_ar || item?.title || 'Item',
    name_ar: item?.name_ar || item?.name || item?.title || 'Item',
    category: item?.category || itemType,
    image_url: item?.image_url || item?.image || item?.images?.[0]?.url || item?.images?.[0] || '',
    price: Number(item?.customer_price || item?.price || item?.base_price || 0),
    customer_price: Number(item?.customer_price || item?.price || item?.base_price || 0),
    description: item?.description || item?.description_ar || item?.details || '',
  });

  const typeLabel = (item) => {
    const type = String(item?.item_type || '').toLowerCase();
    if (type.includes('gift')) return 'هدية';
    if (type.includes('package')) return 'باقة';
    if (type.includes('menu')) return 'مطعم';
    if (type.includes('product')) return 'ماركت';
    return 'منتج';
  };

  useEffect(() => {
    const fetchUpsellItems = async () => {
      try {
        const [menuItems, products, gifts, packages] = await Promise.all([
          base44.entities.MenuItem.list({ limit: 12, sort: { created_date: -1 } }),
          base44.entities.Product.list({ limit: 12, sort: { created_date: -1 } }),
          base44.entities.Gift.list({ limit: 10, sort: { created_date: -1 } }),
          base44.entities.Package.list({ limit: 10, sort: { created_date: -1 } }),
        ]);

        const mixedPool = [
          ...(menuItems || []).map((entry) => normalizeUpsellItem(entry, 'menu_item')),
          ...(products || []).map((entry) => normalizeUpsellItem(entry, 'product')),
          ...(gifts || []).map((entry) => normalizeUpsellItem(entry, 'gift')),
          ...(packages || []).map((entry) => normalizeUpsellItem(entry, 'package')),
        ].filter((entry) => entry?.id && entry?.name);

        const ranked = scoreItemsByBehavior(mixedPool);
        const mixedRanked = interleaveByCategory(ranked, 8);
        setItems(mixedRanked.slice(0, 8));
      } catch (error) {
        console.error('Error fetching upsell items:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchUpsellItems();
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-4 mt-4">
        <div className="flex gap-3 overflow-x-auto">
          {[1,2,3,4].map(i => (
            <div key={i} className="w-[120px] shrink-0 animate-pulse">
              <div className="h-20 bg-gray-200 rounded-lg mb-2" />
              <div className="h-3 bg-gray-200 rounded w-3/4 mx-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!items || items.length === 0) return null;

  const getImageUrl = (item) => {
    // أعطِ الأولوية لــ image_url
    if (item.image_url && typeof item.image_url === 'string' && item.image_url.trim()) return item.image_url;
    if (item.image && typeof item.image === 'string' && item.image.startsWith('http')) return item.image;
    if (item.images && Array.isArray(item.images) && item.images.length > 0) {
      const img = item.images[0];
      return typeof img === 'string' ? img : img?.url;
    }
    return 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&h=200&fit=crop';
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="bg-white rounded-2xl p-4 mt-4"
    >
      <h3 className="font-bold text-gray-900 mb-3 text-base" dir="rtl">
        مقترحات ذكية لك حسب نشاطك 🔥
      </h3>
      
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {items.map((item, index) => (
          <motion.div
            key={item.id || index}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            whileHover={{ scale: 1.05, y: -4, boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}
            whileTap={{ scale: 0.98 }}
            className="w-[140px] shrink-0 bg-gradient-to-br from-white to-gray-50 rounded-2xl p-3 relative cursor-pointer border-2 border-gray-200 hover:border-[#C2185B]/50 transition-all hover:shadow-xl"
          >
            {/* Badge للنوع */}
            <div className="absolute -top-2 right-3 z-10">
              <span className={`inline-block px-2 py-1 text-[10px] font-bold rounded-full text-white shadow-md ${
                typeLabel(item) === 'باقة' ? 'bg-blue-500' :
                typeLabel(item) === 'مطعم' ? 'bg-orange-500' :
                typeLabel(item) === 'ماركت' ? 'bg-green-500' :
                'bg-purple-500'
              }`}>
                {typeLabel(item)}
              </span>
            </div>

            {/* Image - محسّنة */}
            <div className="h-24 w-full rounded-xl overflow-hidden bg-gray-200 mb-3 relative group">
              <img 
                src={getImageUrl(item)} 
                alt={item.name_ar || item.name}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                loading="lazy"
                onError={(e) => { 
                  e.target.src = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=300&h=300&fit=crop'; 
                }}
              />
              {/* Overlay عند الـ hover */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
            </div>
            
            {/* Add Button - محسّن */}
            <motion.button
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => onAddItem(item)}
              className="absolute top-4 -left-4 w-10 h-10 bg-gradient-to-r from-[#C2185B] to-[#E91E63] text-white rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-all"
            >
              <Plus className="w-5 h-5" />
            </motion.button>

            {/* Title - محسّن */}
            <p className="font-bold text-gray-900 line-clamp-2 text-center text-sm mb-1" dir="rtl">
              {item.name_ar || item.name}
            </p>

            {/* Description */}
            <p className="text-[11px] text-gray-600 text-center line-clamp-2 min-h-[2.2rem] mb-2" dir="rtl">
              {item.description || 'خياران رائعان للاختيار'}
            </p>
            
            {/* Price - محسّن */}
            <div className="border-t-2 border-gray-100 pt-2">
              <p className="text-sm font-bold text-[#C2185B] text-center">
                {(item.customer_price || item.price || 0).toLocaleString('en-US')} ل.س
              </p>
              <p className="text-[9px] text-gray-500 text-center mt-0.5">
                ${((item.customer_price || item.price || 0) / exchangeRate).toFixed(2)}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

// =====================================================
// TIP SECTION - الإكرامية بالليرة السورية (10, 30, 60)
// =====================================================
function TipSection({ selectedTipSYP, onTipChange, customTip, onCustomTipChange }) {
  const [showCustomInput, setShowCustomInput] = useState(false);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="bg-white rounded-2xl p-4 mt-4"
    >
      <div className="flex items-start gap-3 mb-3">
        <motion.span 
          className="text-3xl"
          animate={{ rotate: [0, 10, -10, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          🛵
        </motion.span>
        <div>
          <h3 className="font-bold text-gray-900 text-base" dir="rtl">اشكر مندوب التوصيل</h3>
          <p className="text-xs text-gray-500 mt-1" dir="rtl">
            ادعم مندوب التوصيل بتقديم إكرامية، أفعالك اللطيفة تترك آثار كبيرة وترسم بسمة عريضة!
          </p>
        </div>
      </div>

      {/* Tip Options Grid - بالليرة السورية */}
      <div className="grid grid-cols-4 gap-2 mt-3">
        {TIP_OPTIONS.map((option, index) => {
          const isSelected = option.valueSYP === 'custom' 
            ? showCustomInput 
            : selectedTipSYP === option.valueSYP;

          return (
            <motion.button
              key={option.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 * index }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                if (option.valueSYP === 'custom') {
                  if (showCustomInput) {
                    setShowCustomInput(false);
                    onCustomTipChange(0);
                    onTipChange(0);
                    return;
                  }

                  setShowCustomInput(true);
                  const customValue = Number(customTip) || 0;
                  onTipChange(customValue >= 10 ? customValue : 0);
                } else {
                  if (selectedTipSYP === option.valueSYP) {
                    onTipChange(0);
                    return;
                  }

                  setShowCustomInput(false);
                  onTipChange(option.valueSYP);
                }
              }}
              className={`relative py-3 px-2 rounded-xl text-center transition-all ${
                isSelected 
                  ? 'bg-[#C2185B]/10 border-2 border-[#C2185B] text-[#C2185B]' 
                  : 'bg-gray-50 border-2 border-transparent text-gray-700 hover:bg-gray-100'
              }`}
            >
              {option.popular && (
                <motion.span 
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-2 left-1/2 -translate-x-1/2 bg-[#C2185B] text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap"
                >
                  الأكثر شيوعاً
                </motion.span>
              )}
              <span className="text-xl block">{option.emoji}</span>
              <p className="text-xs font-bold mt-1">
                {option.valueSYP === 'custom' ? option.label : `${option.label} ل.س`}
              </p>
            </motion.button>
          );
        })}
      </div>

      {/* Custom Tip Input */}
      <AnimatePresence>
        {showCustomInput && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-3 overflow-hidden"
          >
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-3">
              <Edit3 className="w-4 h-4 text-gray-400" />
              <input
                type="number"
                value={customTip || ''}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10);
                  const parsedValue = Number.isFinite(value) ? value : 0;
                  onCustomTipChange(parsedValue);
                  onTipChange(parsedValue);
                }}
                onBlur={() => {
                  if (!customTip) {
                    onCustomTipChange(0);
                    onTipChange(0);
                    return;
                  }

                  const normalized = Math.max(10, Number(customTip) || 0);
                  onCustomTipChange(normalized);
                  onTipChange(normalized);
                }}
                placeholder="أدخل المبلغ (الحد الأدنى 10 ل.س)"
                min="10"
                className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none"
                dir="rtl"
              />
              <span className="text-xs text-gray-500">ل.س</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Checkbox */}
      <label className="flex items-center gap-2 mt-4 cursor-pointer">
        <input type="checkbox" className="w-4 h-4 rounded border-gray-300 text-[#C2185B] focus:ring-[#C2185B]" />
        <span className="text-xs text-gray-600" dir="rtl">أضف نفس الإكرامية على الطلبات القادمة</span>
      </label>

      {/* Driver Info */}
      <div className="flex items-center gap-2 mt-3 text-xs text-green-600">
        <CheckCircle className="w-4 h-4" />
        <span dir="rtl">سيتم تحويل 100% من الإكرامية لمندوب التوصيل</span>
      </div>
    </motion.div>
  );
}

// =====================================================
// COUPON INPUT - مع أنيميشن
// =====================================================
function CouponInput({ appliedCoupon, onApply, onRemove, isLoading, showAnimation }) {
  const [code, setCode] = useState('');

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="bg-white rounded-2xl p-4 mt-4 relative"
    >
      <div className="flex items-center gap-2 mb-3">
        <Tag className="w-5 h-5 text-[#C2185B]" />
        <h3 className="font-bold text-gray-900 text-base" dir="rtl">أدخل كود الخصم</h3>
      </div>

      {appliedCoupon ? (
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="flex items-center justify-between bg-green-50 rounded-xl px-4 py-3 relative"
        >
          <div className="flex items-center gap-2">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 15 }}
            >
              <CheckCircle className="w-5 h-5 text-green-600" />
            </motion.div>
            <span className="font-bold text-green-700">{appliedCoupon.code}</span>
            <span className="text-sm text-green-600">
              -{appliedCoupon.type === 'percentage' ? `${appliedCoupon.value}%` : `$${appliedCoupon.value}`}
            </span>
          </div>
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onRemove} 
            className="text-gray-400 hover:text-red-500 p-1"
          >
            <X className="w-5 h-5" />
          </motion.button>
          
          {/* Coupon Applied Animation */}
          <AnimatePresence>
            {showAnimation && (
              <div className="absolute top-1/2 right-1/2 transform -translate-y-1/2 translate-x-1/2">
                <SmartLottie
                  animationPath={ANIMATION_PRESETS.couponApplied.path}
                  width={80}
                  height={80}
                  trigger="immediate"
                  hideWhenDone={true}
                />
              </div>
            )}
          </AnimatePresence>
        </motion.div>
      ) : (
        <div className="flex gap-2">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="أدخل كود الخصم"
            className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#C2185B] focus:ring-1 focus:ring-[#C2185B] transition-all"
            dir="rtl"
          />
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => { onApply(code); setCode(''); }}
            disabled={!code.trim() || isLoading}
            className="px-6 py-3 bg-[#C2185B] text-white rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#A01550] transition-colors"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'تطبيق'}
          </motion.button>
        </div>
      )}
    </motion.div>
  );
}

// =====================================================
// PAYMENT METHOD SELECTOR - PayPal + واتساب
// =====================================================
function PaymentMethodSelector({ selected, onChange, allowOnlinePayment = true, walletBalance = 0, insideSyria = false }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="bg-white rounded-2xl p-4 mt-4"
    >
      <h3 className="font-bold text-gray-900 mb-3 text-base" dir="rtl">طريقة إتمام الطلب</h3>
      
      <div className="grid grid-cols-3 gap-2">
        {allowOnlinePayment && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onChange('paypal')}
            className={`p-3 rounded-xl border-2 transition-all ${
              selected === 'paypal' 
                ? 'border-[#FFC439] bg-[#FFC439]/10' 
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-center gap-1">
              <CreditCard className={`w-4 h-4 ${selected === 'paypal' ? 'text-[#003087]' : 'text-gray-500'}`} />
              <span className={`text-xs font-medium ${selected === 'paypal' ? 'text-[#003087]' : 'text-gray-700'}`} dir="rtl">
                إلكتروني
              </span>
            </div>
            <p className="text-[10px] text-[#003087] font-bold mt-1 text-center">PayPal</p>
          </motion.button>
        )}

        {/* Wallet Payment */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onChange('wallet')}
          className={`p-3 rounded-xl border-2 transition-all ${
            selected === 'wallet' 
              ? 'border-[#059669] bg-[#059669]/10' 
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center justify-center gap-1">
            <Wallet className={`w-4 h-4 ${selected === 'wallet' ? 'text-[#059669]' : 'text-gray-500'}`} />
            <span className={`text-xs font-medium ${selected === 'wallet' ? 'text-[#059669]' : 'text-gray-700'}`} dir="rtl">
              المحفظة
            </span>
          </div>
          <p className="text-[10px] text-[#059669] font-bold mt-1 text-center" dir="rtl">
            {walletBalance > 0 ? `${Number(walletBalance).toFixed(2)}$` : 'شحن'}
          </p>
        </motion.button>

        {/* WhatsApp Order */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onChange('whatsapp')}
          className={`p-3 rounded-xl border-2 transition-all ${
            selected === 'whatsapp' 
              ? 'border-[#25D366] bg-[#25D366]/10' 
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center justify-center gap-1">
            <MessageCircle className={`w-4 h-4 ${selected === 'whatsapp' ? 'text-[#25D366]' : 'text-gray-500'}`} />
            <span className={`text-xs font-medium ${selected === 'whatsapp' ? 'text-[#25D366]' : 'text-gray-700'}`} dir="rtl">
              واتساب
            </span>
          </div>
          <p className="text-[10px] text-gray-500 mt-1 text-center" dir="rtl">
            {allowOnlinePayment ? 'عبر واتساب' : 'دفع عند الاستلام'}
          </p>
        </motion.button>

        {/* Shared Cart - داخل سوريا فقط */}
        {insideSyria && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onChange('shared_cart')}
            className={`p-3 rounded-xl border-2 transition-all ${
              selected === 'shared_cart' 
                ? 'border-[#8B5CF6] bg-[#8B5CF6]/10' 
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-center gap-1">
              <Share2 className={`w-4 h-4 ${selected === 'shared_cart' ? 'text-[#8B5CF6]' : 'text-gray-500'}`} />
              <span className={`text-xs font-medium ${selected === 'shared_cart' ? 'text-[#8B5CF6]' : 'text-gray-700'}`} dir="rtl">
                سلة مشتركة
              </span>
            </div>
            <p className="text-[10px] text-[#8B5CF6] mt-1 text-center" dir="rtl">
              شارك مع أحبابك
            </p>
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}

// =====================================================
// ORDER SUMMARY - المجموع الفرعي = مجموع الأسعار المعروضة (مع الزيادة)
// الخصم = الزيادة الوهمية، المجموع بعد الخصم = السعر الأصلي من Base44
// =====================================================
function OrderSummary({ displayedSubtotalSYP, originalTotalSYP, membershipDiscountSYP = 0, tipSYP = 0, couponDiscountSYP = 0, isFreeDelivery = false, appliedCouponCode = null, paymentMethod = 'paypal', exchangeRate = EXCHANGE_RATE, insideSyria = false, isFreeOrderEligible = false }) {
  const [showServiceFeeInfo, setShowServiceFeeInfo] = useState(false);
  
  // الخصم الوهمي = الفرق بين السعر المعروض والسعر الأصلي
  const phantomDiscountSYP = displayedSubtotalSYP - originalTotalSYP;
  
  // ===== نظام الطلبات المجانية (أول 3 طلبات) =====
  // داخل سوريا: إلغاء رسوم التوصيل فقط (الخدمة بالفعل $0)
  // خارج سوريا: إلغاء رسوم الخدمة والتوصيل
  let SERVICE_FEE_USD = insideSyria ? 0 : 6;
  let DELIVERY_FEE_USD = insideSyria ? 1 : 2;
  
  // رسوم خاصة للسلة المشتركة: $6 خدمة + $3 توصيل
  if (paymentMethod === 'shared_cart') {
    SERVICE_FEE_USD = 6;
    DELIVERY_FEE_USD = 3;
  }
  
  if (isFreeOrderEligible) {
    // إذا كان الطلب مجاني، إلغاء رسوم التوصيل للجميع
    DELIVERY_FEE_USD = 0;
    if (!insideSyria) {
      // خارج سوريا: إلغاء رسوم الخدمة أيضاً
      SERVICE_FEE_USD = 0;
    }
  }
  
  const serviceFeeSYP = SERVICE_FEE_USD * exchangeRate;
  const deliveryFeeSYP = DELIVERY_FEE_USD * exchangeRate;
  
  const discountedItemsTotalSYP = Math.max(originalTotalSYP - membershipDiscountSYP, 0);

  // المجموع النهائي بالليرة (بعد خصم العضوية + رسوم الخدمة + التوصيل + الإكرامية - خصم الكوبون)
  const finalTotalSYP = discountedItemsTotalSYP + serviceFeeSYP + deliveryFeeSYP + tipSYP - couponDiscountSYP;
  
  // حساب التوفير الكلي
  const totalSavingsSYP = phantomDiscountSYP + membershipDiscountSYP + (isFreeDelivery ? FAKE_DELIVERY_FEE_SYP : 0) + couponDiscountSYP;
  
  // تحويل القيم للدولار
  const displayedSubtotalUSD = displayedSubtotalSYP / exchangeRate;
  const phantomDiscountUSD = phantomDiscountSYP / exchangeRate;
  const originalTotalUSD = originalTotalSYP / exchangeRate;
  const membershipDiscountUSD = membershipDiscountSYP / exchangeRate;
  const discountedItemsTotalUSD = discountedItemsTotalSYP / exchangeRate;
  const tipUSD = tipSYP / exchangeRate;
  const couponDiscountUSD = couponDiscountSYP / exchangeRate;
  const deliveryFeeUSD = deliveryFeeSYP / exchangeRate;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6 }}
      className="bg-white rounded-2xl p-4 mt-4"
    >
      <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" dir="rtl">
        <p className="text-[12px] text-slate-700">
          سعر الصرف الحالي: <span className="font-bold text-slate-900">1$ = {Number(exchangeRate).toLocaleString('en-US', { maximumFractionDigits: 4 })} ل.س</span>
        </p>
      </div>

      {/* Summary Lines */}
      <div className="space-y-3">
        {/* Subtotal (Inflated for phantom effect) */}
        <div className="flex justify-between text-sm" dir="rtl">
          <span className="text-gray-600">المجموع الفرعي</span>
          <div className="text-left">
            <span className="text-gray-900 font-medium">{displayedSubtotalSYP.toLocaleString('en-US')} ل.س</span>
            <span className="text-gray-400 text-xs mx-2">|</span>
            <span className="text-gray-500 text-xs">${displayedSubtotalUSD.toFixed(2)}</span>
          </div>
        </div>

        {/* Discount (Phantom) */}
        <motion.div 
          initial={{ scale: 1 }}
          animate={{ scale: [1, 1.02, 1] }}
          transition={{ duration: 1, repeat: Infinity, repeatDelay: 3 }}
          className="flex justify-between text-sm" 
          dir="rtl"
        >
          <span className="text-gray-600">الخصم</span>
          <div className="text-left">
            <span className="text-green-600 font-bold">-{phantomDiscountSYP.toLocaleString('en-US')} ل.س</span>
            <span className="text-gray-400 text-xs mx-2">|</span>
            <span className="text-green-500 text-xs">-${phantomDiscountUSD.toFixed(2)}</span>
          </div>
        </motion.div>

        {/* Net Subtotal - السعر الأصلي من Base44 */}
        <div className="flex justify-between text-sm" dir="rtl">
          <span className="text-gray-600">المجموع بعد الخصم</span>
          <div className="text-left">
            <span className="text-gray-900 font-medium">{originalTotalSYP.toLocaleString('en-US')} ل.س</span>
            <span className="text-gray-400 text-xs mx-2">|</span>
            <span className="text-gray-500 text-xs">${originalTotalUSD.toFixed(2)}</span>
          </div>
        </div>

        {membershipDiscountSYP > 0 && (
          <div className="flex justify-between text-sm bg-emerald-50 p-2 rounded-lg" dir="rtl">
            <span className="text-emerald-700 font-semibold">خصم عضوية Wasel+</span>
            <div className="text-left">
              <span className="text-emerald-700 font-bold">-{membershipDiscountSYP.toLocaleString('en-US')} ل.س</span>
              <span className="text-gray-400 text-xs mx-2">|</span>
              <span className="text-emerald-600 text-xs">-${membershipDiscountUSD.toFixed(2)}</span>
            </div>
          </div>
        )}

        {membershipDiscountSYP > 0 && (
          <div className="flex justify-between text-sm" dir="rtl">
            <span className="text-gray-600">المجموع بعد خصم العضوية</span>
            <div className="text-left">
              <span className="text-gray-900 font-medium">{discountedItemsTotalSYP.toLocaleString('en-US')} ل.س</span>
              <span className="text-gray-400 text-xs mx-2">|</span>
              <span className="text-gray-500 text-xs">${discountedItemsTotalUSD.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Service Fee - ثابتة 6 دولار */}
        <div className="flex justify-between text-sm relative" dir="rtl">
          <span className="text-gray-600 flex items-center gap-1">
            رسوم الخدمة
            <button 
              onClick={() => setShowServiceFeeInfo(!showServiceFeeInfo)}
              className="text-xs text-blue-500 hover:text-blue-700 cursor-pointer transition-colors"
            >
              ⓘ
            </button>
          </span>
          <div className="text-left">
            <span className="text-gray-900">{serviceFeeSYP.toLocaleString('en-US')} ل.س</span>
            <span className="text-gray-400 text-xs mx-2">|</span>
            <span className="text-gray-500 text-xs">${SERVICE_FEE_USD.toFixed(2)}</span>
          </div>
        </div>
        
        {/* Service Fee Info Tooltip */}
        <AnimatePresence>
          {showServiceFeeInfo && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800"
              dir="rtl"
            >
              <p className="leading-relaxed">
                يتم تطبيق هذه الرسوم على إجمالي المنتجات الخاصة بك ويساعدنا ذلك في تحسين خدماتنا وتقديم الأفضل لك، ولأحبابك 💙
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Delivery Fee - يظهر حسب اكتمال الشريط */}
        <div className="flex justify-between text-sm items-center" dir="rtl">
          <span className="text-gray-600">رسوم التوصيل</span>
          {isFreeDelivery ? (
            <div className="flex items-center gap-2">
              <span className="text-gray-400 line-through text-xs">{FAKE_DELIVERY_FEE_SYP} ل.س</span>
              <span className="text-green-600 font-bold">مجاناً 🎁</span>
            </div>
          ) : (
            <div className="text-left">
              <span className="text-gray-900">{deliveryFeeSYP.toLocaleString('en-US')} ل.س</span>
              <span className="text-gray-400 text-xs mx-2">|</span>
              <span className="text-gray-500 text-xs">${deliveryFeeUSD.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Tip */}
        {tipSYP > 0 && (
          <div className="flex justify-between text-sm" dir="rtl">
            <span className="text-gray-600">إكرامية المندوب</span>
            <div className="text-left">
              <span className="text-gray-900">{tipSYP.toLocaleString('en-US')} ل.س</span>
              <span className="text-gray-400 text-xs mx-2">|</span>
              <span className="text-gray-500 text-xs">${tipUSD.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Coupon Discount - خصم الكوبون الحقيقي */}
        {couponDiscountSYP > 0 && (
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex justify-between text-sm bg-green-50 p-2 rounded-lg" 
            dir="rtl"
          >
            <span className="text-green-700 flex items-center gap-1">
              <Tag className="w-4 h-4" />
              خصم الكوبون ({appliedCouponCode})
            </span>
            <div className="text-left">
              <span className="text-green-600 font-bold">-{couponDiscountSYP.toLocaleString('en-US')} ل.س</span>
              <span className="text-gray-400 text-xs mx-2">|</span>
              <span className="text-green-500 text-xs">-${couponDiscountUSD.toFixed(2)}</span>
            </div>
          </motion.div>
        )}
      </div>

      {/* Savings Banner */}
      {totalSavingsSYP > 0 && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-4 py-3 px-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl flex items-center justify-center gap-2"
        >
          <motion.span 
            className="text-lg"
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ duration: 1, repeat: Infinity, repeatDelay: 2 }}
          >
            🎉
          </motion.span>
          <span className="text-sm text-green-700 font-bold" dir="rtl">
            مبروك! وفّرت {totalSavingsSYP.toLocaleString('en-US')} ل.س | ${(totalSavingsSYP / exchangeRate).toFixed(2)}
          </span>
        </motion.div>
      )}

      {/* Divider */}
      <div className="border-t border-gray-100 my-4" />

      {/* Final Total - بالليرة والدولار للدفع */}
      <div className="space-y-2">
        <div className="flex justify-between items-center" dir="rtl">
          <span className="font-bold text-gray-900 text-lg">المجموع النهائي</span>
          <div className="text-left">
            <motion.span 
              key={finalTotalSYP}
              initial={{ scale: 1.1 }}
              animate={{ scale: 1 }}
              className="font-bold text-[#C2185B] text-2xl"
            >
              {finalTotalSYP.toLocaleString('en-US')} ل.س
            </motion.span>
            <span className="text-gray-400 mx-2">|</span>
            <span className="font-bold text-[#C2185B] text-lg">${(finalTotalSYP / exchangeRate).toFixed(2)}</span>
          </div>
        </div>
        
        {/* المجموع بالدولار للدفع - يظهر فقط عند اختيار PayPal */}
        {paymentMethod === 'paypal' && (
          <div className="flex justify-between items-center bg-blue-50 rounded-lg px-3 py-2" dir="rtl">
            <span className="text-sm text-blue-700">للدفع عبر PayPal</span>
            <span className="font-bold text-blue-800 text-lg">${(finalTotalSYP / exchangeRate).toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Warning */}
      <p className="text-xs text-red-500 text-center mt-4" dir="rtl">
        لا يمكن إلغاء أو استرجاع المبلغ بعد إجراء الطلب.
      </p>
    </motion.div>
  );
}

// =====================================================
// PRODUCT DETAIL MODAL - عرض تفاصيل المنتج
// =====================================================
function ProductDetailModal({ item, isOpen, onClose, onAddToCart, exchangeRate = EXCHANGE_RATE }) {
  if (!isOpen || !item) return null;

  // السعر من Base44 بالليرة أصلاً
  const priceSYP = item.customer_price || item.price || 0;
  const priceUSD = priceSYP / exchangeRate;

  const getImageUrl = () => {
    if (item.image_url && typeof item.image_url === 'string' && item.image_url.trim()) return item.image_url;
    if (item.image && typeof item.image === 'string' && item.image.startsWith('http')) return item.image;
    if (item.images && Array.isArray(item.images) && item.images.length > 0) {
      const img = item.images[0];
      return typeof img === 'string' ? img : img?.url;
    }
    return 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop';
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-white rounded-t-3xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close Handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
          </div>

          {/* Image */}
          <div className="w-full h-64 bg-gray-100">
            <img 
              src={getImageUrl()} 
              alt={item.name_ar || item.name}
              className="w-full h-full object-cover"
              onError={(e) => { 
                e.target.src = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop'; 
              }}
            />
          </div>

          {/* Content */}
          <div className="p-5" dir="rtl">
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              {item.name_ar || item.name}
            </h2>
            
            {(item.description_ar || item.description) && (
              <p className="text-gray-600 text-sm mb-4">
                {item.description_ar || item.description}
              </p>
            )}

            <div className="flex items-center justify-between mb-6">
              <div>
                <span className="text-2xl font-bold text-[#C2185B]">
                  {priceSYP.toLocaleString('en-US')} ل.س
                </span>
                <span className="text-sm text-gray-500 block">
                  (${priceUSD.toFixed(2)})
                </span>
              </div>
            </div>

            {/* Add to Cart Button */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                onAddToCart(item);
                onClose();
              }}
              className="w-full py-4 bg-[#C2185B] text-white rounded-xl font-bold hover:bg-[#A01550] transition-colors"
            >
              إضافة إلى السلة
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// =====================================================
// MAIN CART COMPONENT
// =====================================================
const Cart = () => {
  const navigate = useNavigate();
  const { cartItems = [], updateQuantity, removeFromCart, addToCart, clearCart } = useCart() || {};
  
  const [isUpdating, setIsUpdating] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [selectedTipSYP, setSelectedTipSYP] = useState(0); // الإكرامية بالليرة
  const [customTip, setCustomTip] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('paypal');
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [showPayPal, setShowPayPal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [isWaselPlusMember, setIsWaselPlusMember] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState('');
  const [userRegion, setUserRegion] = useState(null);
  const [showCouponAnimation, setShowCouponAnimation] = useState(false);
  const [showPaymentAnimation, setShowPaymentAnimation] = useState(false);
  const [showPaymentSuccessAnimation, setShowPaymentSuccessAnimation] = useState(false);
  const [paymentSuccessMessage, setPaymentSuccessMessage] = useState('');
  
  // ===== نظام الطلبات المجانية =====
  const [freeOrdersRemaining, setFreeOrdersRemaining] = useState(3);
  const [isFreeOrderEligible, setIsFreeOrderEligible] = useState(false);
  const [showFreeOrderNotification, setShowFreeOrderNotification] = useState(false);
  const [freeOrderNotificationMessage, setFreeOrderNotificationMessage] = useState('');
  
  const exchangeRate = useUsdToSypRate() || EXCHANGE_RATE;
  const insideSyria = isInsideSyria(userRegion);

  useEffect(() => {
    setUserRegion(getUserRegion());
  }, []);

  // Auto-hide coupon animation after 2 seconds
  useEffect(() => {
    if (!showCouponAnimation) return;
    const timer = setTimeout(() => {
      setShowCouponAnimation(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [showCouponAnimation]);

  // Auto-hide payment success animation after 2.5 seconds
  useEffect(() => {
    if (!showPaymentSuccessAnimation) return;
    const timer = setTimeout(() => {
      setShowPaymentSuccessAnimation(false);
    }, 2500);
    return () => clearTimeout(timer);
  }, [showPaymentSuccessAnimation]);

  // Load wallet balance
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;
        const { data } = await supabase
          .from('wallets')
          .select('balance_usd')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (data) setWalletBalance(Number(data.balance_usd) || 0);
      } catch {}
    })();
  }, []);

  // ===== تحميل الطلبات المجانية المتبقية =====
  useEffect(() => {
    const checkFreeOrders = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        const email = session?.user?.email || currentUserEmail;

        if (!userId && !email) return;

        // جلب عدد الطلبات المجانية المتبقية
        const { data, error } = await supabase.rpc('get_user_free_orders_remaining', {
          p_user_id: userId || null,
          p_email: email
        });

        if (error) {
          console.warn('Free orders check not available yet:', error.message);
          // في الحالة الأولى، اعتبر جميع الطلبات مجانية
          setIsFreeOrderEligible(true);
          setFreeOrdersRemaining(3);
          setFreeOrderNotificationMessage('🎉 أول 3 طلبات بتوصيل مجاني!');
          setShowFreeOrderNotification(true);
          return;
        }

        if (data && data.length > 0) {
          const remaining = data[0].free_orders_remaining || 0;
          setFreeOrdersRemaining(remaining);
          setIsFreeOrderEligible(remaining > 0);

          if (remaining > 0) {
            const message = remaining === 3 
              ? '🎉 الطلبات الثلاثة الأولى بتوصيل مجاني!'
              : remaining === 1
              ? '⚠️ هذا آخر طلب مجاني! من الطلب الرابع ستبدأ الرسوم العادية'
              : `✨ لديك ${remaining} طلبات مجانية متبقية`;
            
            setFreeOrderNotificationMessage(message);
            setShowFreeOrderNotification(true);
          }
        }
      } catch (err) {
        console.error('Error checking free orders:', err);
        // القيم الافتراضية
        setIsFreeOrderEligible(true);
        setFreeOrdersRemaining(3);
      }
    };

    checkFreeOrders();
  }, [currentUserEmail]);

  useEffect(() => {
    if (insideSyria && paymentMethod === 'paypal') {
      setPaymentMethod('whatsapp');
    }
  }, [insideSyria, paymentMethod]);

  const getPendingPayPalOrders = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem(PAYPAL_PENDING_ORDERS_KEY) || '[]');
    } catch (error) {
      console.error('Failed to parse pending PayPal orders:', error);
      return [];
    }
  }, []);

  const savePendingPayPalOrders = useCallback((orders) => {
    localStorage.setItem(PAYPAL_PENDING_ORDERS_KEY, JSON.stringify(orders));
  }, []);

  const getSavedPayPalCaptures = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem(PAYPAL_SAVED_CAPTURES_KEY) || '[]');
    } catch (error) {
      console.error('Failed to parse saved PayPal captures:', error);
      return [];
    }
  }, []);

  const markPayPalCaptureSaved = useCallback((captureId) => {
    if (!captureId) return;
    const current = getSavedPayPalCaptures();
    if (current.includes(captureId)) return;
    localStorage.setItem(PAYPAL_SAVED_CAPTURES_KEY, JSON.stringify([...current, captureId].slice(-100)));
  }, [getSavedPayPalCaptures]);

  const isPayPalCaptureSaved = useCallback((captureId) => {
    if (!captureId) return false;
    return getSavedPayPalCaptures().includes(captureId);
  }, [getSavedPayPalCaptures]);

  const extractPayPalCaptureId = useCallback((paypalDetails) => {
    return (
      paypalDetails?.id ||
      paypalDetails?.purchase_units?.[0]?.payments?.captures?.[0]?.id ||
      paypalDetails?.orderID ||
      null
    );
  }, []);

  // Sender/Receiver Info State
  const [senderName, setSenderName] = useState('');
  const [senderCountry, setSenderCountry] = useState('الإمارات');
  const [senderPhone, setSenderPhone] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [sharedCartMode, setSharedCartMode] = useState(false);
  const [sharedCartCreator, setSharedCartCreator] = useState(null);
  const [sharedCartToken, setSharedCartToken] = useState(null);
  
  useEffect(() => {
    try {
      const sessionStr = localStorage.getItem('wasel_shared_cart_session');
      if (sessionStr) {
        const session = JSON.parse(sessionStr);
        setSharedCartMode(true);
        setSharedCartToken(session.token);
        setSharedCartCreator(session.creator_id);
        
        if (session.recipient) {
          setRecipientName(session.recipient.name || '');
          setRecipientPhone(session.recipient.phone || '');
          setRecipientAddress(session.recipient.address || '');
        }
      }
    } catch(e) {}
  }, []);
  
  const handleClearSharedCart = () => {
    localStorage.removeItem('wasel_shared_cart_session');
    setSharedCartMode(false);
    setSharedCartToken(null);
    setSharedCartCreator(null);
    setRecipientName('');
    setRecipientPhone('');
    setRecipientAddress('');
    toast.success('تم إلغاء وضع السلة المشتركة يمكنك إنشاء طلبك الخاص');
  };
  const [recipientPhone, setRecipientPhone] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [addressSavedManually, setAddressSavedManually] = useState(false);
  const [creatingCartShareLink, setCreatingCartShareLink] = useState(false);

  // Calling code for sender
  const senderCallingCode = senderCountry ? getCallingCode(getCountryByArabicName(senderCountry)?.code) : '+971';

  // Load saved sender/receiver info on mount
  useEffect(() => {
    const savedSender = getSavedSenderInfo();
    const savedReceiver = getSavedReceiverInfo();
    const selectedAddress = getSelectedAddress();

    if (savedSender) {
      setSenderName(savedSender.name || '');
      setSenderCountry(savedSender.country || 'الإمارات');
      setSenderPhone(savedSender.phone || '');
    }

    if (savedReceiver) {
      setRecipientName(savedReceiver.name || '');
      setRecipientPhone(savedReceiver.phone || '');
      setRecipientAddress(savedReceiver.address || '');
    }

    if (selectedAddress?.street) {
      setRecipientName(selectedAddress.label || savedReceiver?.name || '');
      setRecipientPhone(selectedAddress.phone || savedReceiver?.phone || '');
      setRecipientAddress(selectedAddress.street || savedReceiver?.address || '');
      setSenderName(selectedAddress.sender_name || savedSender?.name || '');
      setSenderPhone(selectedAddress.sender_phone || savedSender?.phone || '');
      setSenderCountry(selectedAddress.sender_country || savedSender?.country || 'الإمارات');
    }
  }, []);

  // Save sender info when it changes
  useEffect(() => {
    if (senderName || senderPhone) {
      saveSenderInfo({
        name: senderName,
        country: senderCountry,
        phone: senderPhone
      });
    }
  }, [senderName, senderCountry, senderPhone]);

  // Save receiver info when it changes
  useEffect(() => {
    if (recipientName || recipientPhone || recipientAddress) {
      saveReceiverInfo({
        name: recipientName,
        phone: recipientPhone,
        address: recipientAddress
      });
    }
  }, [recipientName, recipientPhone, recipientAddress]);

  useEffect(() => {
    const loadMembershipState = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        const userEmail = user?.email;
        setCurrentUserEmail(userEmail || '');
        if (!userEmail) {
          setIsWaselPlusMember(false);
          return;
        }

        const { data, error } = await supabase
          .from('wasel_plus_memberships')
          .select('status, end_date, trial_end')
          .eq('user_email', userEmail)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error || !data) {
          setIsWaselPlusMember(false);
          return;
        }

        const now = Date.now();
        const activeEnd = data?.status === 'active' && data?.end_date ? Date.parse(data.end_date) : null;
        const trialEnd = data?.status === 'trialing' && data?.trial_end ? Date.parse(data.trial_end) : null;
        const activeMember =
          (data.status === 'active' && (!activeEnd || activeEnd > now)) ||
          (data.status === 'trialing' && (!trialEnd || trialEnd > now));

        setIsWaselPlusMember(Boolean(activeMember && WASEL_PLUS_STATUSES.includes(data.status)));
      } catch (error) {
        console.error('Failed to load Wasel+ state in cart:', error);
        setCurrentUserEmail('');
        setIsWaselPlusMember(false);
      }
    };

    loadMembershipState();
  }, []);

  // حساب المجموع الأصلي بالليرة (الأسعار من Base44 بالليرة أصلاً)
  const originalTotalSYP = useMemo(() => {
    return cartItems.reduce((sum, item) => {
      // السعر الأصلي من Base44 بالليرة السورية
      const originalPriceSYP = item.customer_price || item.price || 0;
      return sum + (originalPriceSYP * (item.quantity || 1));
    }, 0);
  }, [cartItems]);

  // حساب المجموع المعروض (مع الزيادة الوهمية 20%)
  const displayedSubtotalSYP = useMemo(() => {
    return cartItems.reduce((sum, item) => {
      const originalPriceSYP = item.customer_price || item.price || 0;
      const displayedPriceSYP = Math.round(originalPriceSYP * MARKUP_FACTOR);
      return sum + (displayedPriceSYP * (item.quantity || 1));
    }, 0);
  }, [cartItems]);

  const membershipDiscountSYP = useMemo(() => {
    if (!isWaselPlusMember) return 0;

    return cartItems.reduce((sum, item) => {
      const originalPriceSYP = item.customer_price || item.price || 0;
      const quantity = item.quantity || 1;
      const rate = getMembershipDiscountRate(item);
      return sum + Math.round(originalPriceSYP * quantity * rate);
    }, 0);
  }, [cartItems, isWaselPlusMember]);

  const discountedItemsTotalSYP = Math.max(originalTotalSYP - membershipDiscountSYP, 0);

  // هل التوصيل مجاني؟ (إذا اكتمل الشريط)
  const isFreeDelivery = originalTotalSYP >= FREE_DELIVERY_THRESHOLD_SYP;
  
  // رسوم التوصيل - $3 للسلة المشتركة، وإلا 300 ل.س إذا لم يكتمل الشريط
  const deliveryFeeSYP = paymentMethod === 'shared_cart'
    ? 3 * exchangeRate
    : (isFreeDelivery ? 0 : FAKE_DELIVERY_FEE_SYP);

  // رسوم الخدمة ثابتة = 6 دولار = 900 ليرة
  const SERVICE_FEE_USD = 6;
  const serviceFeeSYP = SERVICE_FEE_USD * exchangeRate;

  // المجموع قبل خصم الكوبون (لحساب الخصم منه)
  const subtotalBeforeCouponSYP = discountedItemsTotalSYP + serviceFeeSYP + deliveryFeeSYP + selectedTipSYP;

  // خصم الكوبون بالليرة (يُحسب فقط إذا كان الكوبون حقيقي)
  const couponDiscountSYP = useMemo(() => {
    // الخصم يُطبق فقط على الكوبونات الحقيقية (مثل Daraa)
    if (!appliedCoupon || !appliedCoupon.isReal) return 0;
    if (appliedCoupon.type === 'percentage') {
      // الخصم يكون على المجموع الكلي (السعر الأصلي + رسوم الخدمة + التوصيل)
      return Math.round((subtotalBeforeCouponSYP * appliedCoupon.value) / 100);
    }
    // إذا كانت القيمة ثابتة نفترض أنها بالليرة
    return appliedCoupon.value;
  }, [appliedCoupon, subtotalBeforeCouponSYP]);

  // المجموع النهائي بالليرة
  const finalTotalSYP = subtotalBeforeCouponSYP - couponDiscountSYP;
  
  // المجموع النهائي بالدولار لـ PayPal
  const finalTotalUSD = finalTotalSYP / exchangeRate;

  // Handle quantity change
  const handleQuantityChange = useCallback(async (itemId, newQuantity) => {
    if (newQuantity <= 0) {
      removeFromCart?.(itemId);
      toast.success('تم حذف العنصر من السلة');
    } else {
      setIsUpdating(true);
      await updateQuantity?.(itemId, newQuantity);
      setIsUpdating(false);
    }
  }, [updateQuantity, removeFromCart]);

  // Handle remove
  const handleRemoveItem = useCallback((itemId) => {
    removeFromCart?.(itemId);
    toast.success('تم حذف العنصر من السلة');
  }, [removeFromCart]);

  // Handle view details
  const handleViewDetails = useCallback((item) => {
    setSelectedItem(item);
    setShowDetailModal(true);
  }, []);

  // Handle add upsell - مع الأسعار الصحيحة من Base44 (بالليرة)
  const handleAddUpsellItem = useCallback((item) => {
    addToCart?.({
      ...item,
      id: item.id,
      name: item.name_ar || item.name,
      name_ar: item.name_ar || item.name,
      // السعر بالليرة من Base44
      price: item.customer_price || item.price || 0,
      customer_price: item.customer_price || item.price || 0,
      image_url: item.image_url || item.image,
      image: item.image || item.image_url,
      images: item.images,
      quantity: 1
    });
    toast.success(`تمت إضافة ${item.name_ar || item.name} إلى السلة`);
  }, [addToCart]);

  // Handle coupon - كود Daraa يعطي 20% خصم حقيقي
  const handleApplyCoupon = useCallback(async (code) => {
    if (!code) return;
    setCouponLoading(true);
    
    // تحويل الكود لأحرف كبيرة للمقارنة
    const upperCode = code.toUpperCase();
    
    setTimeout(() => {
      // الكوبونات الصالحة - Daraa هو الكود الحقيقي الوحيد
      const validCoupons = {
        'DARAA': { type: 'percentage', value: 20, isReal: true, message: '🎉 مبروك! حصلت على خصم 20% من درعا' },
        'WASEL20': { type: 'percentage', value: 20, isReal: false },
        'WELCOME10': { type: 'percentage', value: 10, isReal: false },
        'MISSYOU': { type: 'percentage', value: 20, isReal: false },
        'AB20': { type: 'percentage', value: 20, isReal: false },
      };
      
      if (validCoupons[upperCode]) {
        const coupon = validCoupons[upperCode];
        setAppliedCoupon({ code: upperCode, ...coupon });
        setShowCouponAnimation(true);
        
        if (coupon.isReal) {
          // خصم حقيقي - عرض رسالة خاصة
          toast.success(coupon.message, { duration: 4000 });
        } else {
          toast.success('تم تطبيق الكوبون بنجاح!');
        }
      } else {
        toast.error('كود الخصم غير صالح');
      }
      setCouponLoading(false);
    }, 800);
  }, []);

  const handleSaveDeliveryAddress = useCallback(() => {
    const result = saveAddressFromRecipient({
      name: recipientName,
      phone: recipientPhone,
      address: recipientAddress,
      senderName: insideSyria ? '' : senderName,
      senderPhone: insideSyria ? '' : senderPhone,
      senderCountry: insideSyria ? '' : senderCountry,
    });

    if (!result.success) {
      toast.error('أدخل اسم المستلم والعنوان أولاً لحفظ العنوان');
      return;
    }

    setAddressSavedManually(true);
    if (result.duplicated) {
      toast.success('هذا العنوان محفوظ مسبقاً وتم تعيينه كعنوان افتراضي');
    } else {
      toast.success('تم حفظ العنوان وسيظهر في صفحة عناويني');
    }
  }, [recipientName, recipientPhone, recipientAddress, senderName, senderPhone, senderCountry, insideSyria]);

  // إنشاء رسالة واتساب منظّمة وجذابة مع رقم الطلب
  const createWhatsAppMessage = useCallback((options = {}) => {
    const orderNumber = options.orderNumber || 'قيد الإنشاء';

    const lines = [];
    lines.push('اهلاً فريق واصل،');
    lines.push('ارغب بإكمال الطلب التالي عبر واتساب:');
    lines.push('');
    lines.push(`رقم الطلب: ${orderNumber}`);
    lines.push('');
    lines.push('تفاصيل المنتجات:');

    cartItems.forEach((item, index) => {
      const priceSYP = item.customer_price || item.price || 0;
      const quantity = item.quantity || 1;
      const totalSYP = priceSYP * quantity;
      lines.push(`${index + 1}) ${item.name_ar || item.name} × ${quantity} = ${Math.round(totalSYP).toLocaleString('en-US')} SYP`);
    });

    lines.push('');
    lines.push(`المجموع الكلي: ${Math.round(finalTotalSYP).toLocaleString('en-US')} SYP`);
    lines.push(`المجموع بالدولار: $${finalTotalUSD.toFixed(2)}`);

    if (selectedTipSYP > 0) {
      lines.push(`اكرامية السائق: ${Math.round(selectedTipSYP).toLocaleString('en-US')} SYP`);
    }

    if (appliedCoupon?.code) {
      lines.push(`كود الخصم: ${appliedCoupon.code}`);
    }

    if (membershipDiscountSYP > 0) {
      lines.push(`خصم Wasel+: -${Math.round(membershipDiscountSYP).toLocaleString('en-US')} SYP`);
    }

    lines.push('');
    lines.push('بيانات التوصيل:');
    lines.push(`اسم المرسل: ${senderName || '-'}`);
    lines.push(`بلد المرسل: ${senderCountry || '-'}`);
    lines.push(`رقم المرسل: ${senderPhone ? `${senderCallingCode} ${senderPhone.replace(senderCallingCode, '').trim()}` : '-'}`);
    lines.push(`اسم المستلم: ${recipientName || '-'}`);
    lines.push(`رقم المستلم: ${recipientPhone || '-'}`);
    lines.push(`العنوان: ${recipientAddress || '-'}`);

    if (additionalNotes) {
      lines.push(`ملاحظات: ${additionalNotes}`);
    }

    if (deliveryTime) {
      lines.push(`وقت التوصيل المفضل: ${deliveryTime}`);
    }

    lines.push('');
    lines.push('شكراً لكم مقدماً.');

    return lines.join('\n');
  }, [cartItems, finalTotalSYP, finalTotalUSD, selectedTipSYP, appliedCoupon, membershipDiscountSYP, senderName, senderCountry, senderPhone, senderCallingCode, recipientName, recipientPhone, recipientAddress, additionalNotes, deliveryTime]);

  const handleShareCart = useCallback(async () => {
    try {
      setCreatingCartShareLink(true);
      const sharePayload = {
        sender: {
          name: insideSyria ? recipientName : (senderName || 'غير محدد'),
          email: currentUserEmail || 'guest@example.com',
          phone: insideSyria ? recipientPhone : (senderPhone || ''),
          country: insideSyria ? 'syria' : (senderCountry || 'uae'),
        },
        recipient: {
          name: recipientName || 'غير محدد',
          phone: recipientPhone || '',
          address: recipientAddress || '',
            delivery_time: deliveryTime || null
          },
        items: cartItems.map((item) => ({
          id: item.id,
          name: item.name,
          name_ar: item.name_ar,
          quantity: item.quantity,
          priceSYP: item.customer_price || item.price || 0,
          priceUSD: ((item.customer_price || item.price || 0) / exchangeRate),
          image_url: item.image_url || item.image,
        })),
        totalSYP: finalTotalSYP,
        totalUSD: finalTotalUSD,
        membershipDiscountSYP,
        tip: selectedTipSYP,
        coupon: appliedCoupon?.code || null,
        notes: additionalNotes || '',
        deliveryTime: deliveryTime || null,
        sourceRegion: insideSyria ? 'inside_syria' : 'outside_syria',
      };

      const { data, error } = await supabase.rpc('create_cart_share_link', {
        p_payload: sharePayload,
        p_expires_in_hours: 72,
      });

      if (error) throw error;

      const shareUrl = buildPublicAppUrl(`/shared-cart/${data.token}`);

      // Create a real draft order immediately when sharing the cart,
      // so supervisors can track it before the payer completes checkout.
      const sharedOrderNumber = `WAS-SH-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      let sharedOrder = null;
      let sharedOrderError = null;

      try {
        const rpc = await supabase.rpc('create_compatible_order_v2', {
          p_order: {
            sender: sharePayload.sender,
            recipient: sharePayload.recipient,
            items: sharePayload.items,
            totalSYP: sharePayload.totalSYP,
            totalUSD: sharePayload.totalUSD,
            membershipDiscountSYP: sharePayload.membershipDiscountSYP,
            paymentMethod: 'whatsapp',
            notes: `طلب سلة مشتركة بانتظار دفع الطرف الخارجي.${additionalNotes ? ` ${additionalNotes}` : ''}`,
            deliveryTime: sharePayload.deliveryTime,
            tip: sharePayload.tip,
            coupon: sharePayload.coupon,
            orderNumber: sharedOrderNumber,
            collaborationMode: 'shared',
            metadata: {
              created_via: 'shared_cart_link',
              shared_cart_token: data.token,
              shared_cart_url: shareUrl,
              source_region: sharePayload.sourceRegion,
            },
          },
        });

        if (!rpc.error && rpc.data) {
          sharedOrder = rpc.data;
        } else {
          sharedOrderError = rpc.error;
        }
      } catch (rpcError) {
        sharedOrderError = rpcError;
      }

      if (!sharedOrder) {
        const { data: authData } = await supabase.auth.getUser();
        const authUser = authData?.user;
        const directPayload = {
          order_number: sharedOrderNumber,
          status: 'pending',
          payment_status: 'pending',
          payment_method: 'whatsapp',
          total_amount: Number(sharePayload.totalUSD || 0),
          total_usd: Number(sharePayload.totalUSD || 0),
          total_syp: Number(sharePayload.totalSYP || 0),
          currency: 'USD',
          items: sharePayload.items,
          collaboration_mode: 'shared',
          sender_details: {
            ...sharePayload.sender,
            meta: {
              created_via: 'shared_cart_link',
              shared_cart_token: data.token,
              shared_cart_url: shareUrl,
              sourceRegion: sharePayload.sourceRegion,
            },
          },
          recipient_details: sharePayload.recipient,
          notes: `طلب سلة مشتركة بانتظار دفع الطرف الخارجي.${additionalNotes ? ` ${additionalNotes}` : ''}`,
        };

        if (authUser?.id) {
          directPayload.user_id = authUser.id;
        }

        const { data: insertedOrder, error: directInsertError } = await supabase
          .from('orders')
          .insert([directPayload])
          .select('*')
          .single();

        if (directInsertError) {
          throw sharedOrderError || directInsertError;
        }
        sharedOrder = insertedOrder;
      }

      // Ensure order_items contains this order snapshot for supervisor readability.
      try {
        if (sharedOrder?.id && Array.isArray(sharePayload.items) && sharePayload.items.length > 0) {
          const orderItems = sharePayload.items.map((item) => ({
            order_id: sharedOrder.id,
            item_name: item.name_ar || item.name,
            item_id: item.id || crypto.randomUUID(),
            item_type: item.item_type || 'product',
            quantity: item.quantity,
            unit_price: Number(item.priceUSD || 0),
            total_price: Number(item.priceUSD || 0) * (item.quantity || 1),
            item_image: item.image_url,
          }));
          await supabase.from('order_items').insert(orderItems);
        }
      } catch (itemsError) {
        console.warn('Share cart order_items warning:', itemsError);
      }

      // Firebase + in-app notifications for supervisors/admins.
      try {
        const notifyResult = await notifyAdminUsers('new_order_created', sharedOrder, {
          paymentMethod: 'shared_cart',
          source: 'cart_share_link_created',
        });

        if (notifyResult && Number(notifyResult.total || 0) > 0 && Number(notifyResult.sent || 0) === 0) {
          toast.warning('تم إنشاء الطلب، لكن لم يصل إشعار Push للمشرف. تحقق من ربط جهاز المشرف.');
        }
      } catch (notifyError) {
        console.warn('Share cart admin notify warning:', notifyError);
        toast.warning('تم إنشاء الطلب، لكن حدثت مشكلة أثناء إشعار المشرف.');
      }

      const compactItems = cartItems.slice(0, 8).map((item, idx) => {
        const itemQty = item.quantity || 1;
        const itemLineTotal = (item.customer_price || item.price || 0) * itemQty;
        return `   ${idx + 1}. ${item.name_ar || item.name || 'منتج'} × ${itemQty} = ${Math.round(itemLineTotal).toLocaleString('en-US')} ل.س`;
      }).join('\n');
      const moreItemsNote = cartItems.length > 8 ? `\n   ... +${cartItems.length - 8} منتجات إضافية` : '';

      const shareText = [
        '🛍️  *سلّة واصل*',
        '━━━━━━━━━━━━━━━━',
        '',
        'أهلاً! قمت بتجهيز سلة مشتريات خاصة',
        'عبر تطبيق *واصل* ويمكنك إتمامها بسهولة:',
        '',
        '📦 *المنتجات:*',
        compactItems || '   - لا توجد عناصر',
        moreItemsNote,
        '',
        '━━━━━━━━━━━━━━━━',
        `💵 *المجموع الكلي:* $${finalTotalUSD.toFixed(2)}`,
        '   (شامل رسوم الخدمة والتوصيل)',
        '',
        '🔗 *أكمل الطلب من هنا:*',
        shareUrl,
        '',
        '━━━━━━━━━━━━━━━━',
        'واصل - نوصّل لأحبابك 💙',
      ].filter(Boolean).join('\n');

      try {
        if (navigator.share) {
          await navigator.share({ title: 'تطبيق واصل - مشاركة سلة', text: shareText, url: shareUrl });
        } else {
          await navigator.clipboard.writeText(shareText);
        }
      } catch (shareError) {
        // If native share is dismissed, keep the order flow successful and fallback to clipboard.
        try { await navigator.clipboard.writeText(shareText); } catch (_) { /* noop */ }
        console.warn('Share cart native share warning:', shareError);
      }

      clearCart?.();
      localStorage.removeItem('wasel_shared_cart_session');
      navigate('/MyOrders', { state: { showInvoicePrompt: true, invoiceOrderId: sharedOrder?.id || null } });
      toast.success('تم إنشاء رابط السلة والطلب وإرساله للمشرف، وتم نقله إلى طلباتي');
    } catch (error) {
      console.error('Share cart failed:', error);
      if (isMissingRpcFunctionError(error, 'create_cart_share_link')) {
        toast.error('مشاركة السلة تحتاج تحديث قاعدة البيانات: شغّل migration 010_cart_share_links_checkout.sql');
      } else if (isMissingRpcFunctionError(error, 'create_compatible_order_v2')) {
        toast.error('إنشاء طلب السلة المشتركة يحتاج تحديث قاعدة البيانات: شغّل migration 013_create_compatible_order_rpc_v2.sql');
      } else {
        toast.error('تعذر مشاركة السلة');
      }
    } finally {
      setCreatingCartShareLink(false);
    }
  }, [insideSyria, recipientName, recipientPhone, recipientAddress, senderName, senderPhone, senderCountry, currentUserEmail, cartItems, exchangeRate, finalTotalSYP, finalTotalUSD, membershipDiscountSYP, selectedTipSYP, appliedCoupon, additionalNotes, deliveryTime, clearCart, navigate]);

  const handleDownloadInvoicePdf = useCallback(async () => {
    try {
      const { jsPDF } = await import('jspdf');
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      const invoiceNumber = `WSL-${stamp}`;
      const deliveryFee = isFreeDelivery ? 0 : FAKE_DELIVERY_FEE_SYP;
      const itemsRows = cartItems.map((item, index) => {
        const priceSYP = item.customer_price || item.price || 0;
        const qty = item.quantity || 1;
        const itemName = item.name || item.name_ar || `Item ${index + 1}`;
        return `<tr>
          <td style="padding:6px;border-bottom:1px solid #eee;">${index + 1}</td>
          <td style="padding:6px;border-bottom:1px solid #eee;">${itemName}</td>
          <td style="padding:6px;border-bottom:1px solid #eee;">${qty}</td>
          <td style="padding:6px;border-bottom:1px solid #eee;">${Math.round(priceSYP).toLocaleString('en-US')} SYP</td>
          <td style="padding:6px;border-bottom:1px solid #eee;">${Math.round(priceSYP * qty).toLocaleString('en-US')} SYP</td>
        </tr>`;
      }).join('');

      const qrPayload = `Invoice:${invoiceNumber}|TotalUSD:${finalTotalUSD.toFixed(2)}|Payment:${paymentMethod === 'paypal' ? 'PayPal' : 'WhatsApp'}|Date:${now.toISOString()}`;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrPayload)}`;
      const logoUrl = '/logo/wasel-logo.png';
      const fallbackLogoUrl = '/wasel-mascot.png';

      const container = document.createElement('div');
      container.style.width = '760px';
      container.style.padding = '20px';
      container.style.background = '#ffffff';
      container.style.fontFamily = "'Cairo', Arial, sans-serif";
      container.innerHTML = `
        <div dir="ltr" style="color:#111;line-height:1.45;font-family:Arial,sans-serif;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
            <div>
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                <img src="${logoUrl}" alt="Wasel" style="width:52px;height:52px;object-fit:contain;border-radius:8px;border:1px solid #eee;padding:3px;" onerror="this.onerror=null;this.src='${fallbackLogoUrl}';" />
                <h1 style="margin:0;font-size:30px;">Wasel Invoice</h1>
              </div>
              <div style="font-size:14px;">Invoice Number: ${invoiceNumber}</div>
              <div style="font-size:14px;">Date: ${now.toLocaleString()}</div>
              <div style="font-size:14px;">Payment Method: ${paymentMethod === 'paypal' ? 'PayPal' : 'WhatsApp'}</div>
            </div>
            <img src="${qrUrl}" alt="QR" style="width:90px;height:90px;border:1px solid #ddd;padding:3px;border-radius:8px;" />
          </div>

          <hr style="margin:18px 0;border:none;border-top:1px solid #ddd;" />

          <h3 style="margin:0 0 6px;">Sender Details</h3>
          <div style="font-size:14px;">Name: ${senderName || '-'}</div>
          <div style="font-size:14px;">Phone: ${senderCallingCode} ${senderPhone || '-'}</div>
          <div style="font-size:14px;">Country: ${senderCountry || '-'}</div>

          <h3 style="margin:16px 0 6px;">Recipient Details</h3>
          <div style="font-size:14px;">Name: ${recipientName || '-'}</div>
          <div style="font-size:14px;">Phone: ${recipientPhone || '-'}</div>
          <div style="font-size:14px;">Address: ${recipientAddress || '-'}</div>

          <h3 style="margin:18px 0 8px;">Items</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f8fafc;text-align:left;">
                <th style="padding:6px;">#</th>
                <th style="padding:6px;">Item</th>
                <th style="padding:6px;">Qty</th>
                <th style="padding:6px;">Price</th>
                <th style="padding:6px;">Total</th>
              </tr>
            </thead>
            <tbody>${itemsRows}</tbody>
          </table>

          <div style="margin-top:14px;font-size:15px;font-weight:700;">
            <div>Items Total: ${Math.round(originalTotalSYP).toLocaleString('en-US')} SYP</div>
            ${membershipDiscountSYP > 0 ? `<div>Membership Discount: -${Math.round(membershipDiscountSYP).toLocaleString('en-US')} SYP</div>` : ''}
            ${couponDiscountSYP > 0 ? `<div>Coupon Discount: -${Math.round(couponDiscountSYP).toLocaleString('en-US')} SYP</div>` : ''}
            ${selectedTipSYP > 0 ? `<div>Driver Tip: ${Math.round(selectedTipSYP).toLocaleString('en-US')} SYP</div>` : ''}
            <div>Service Fee: ${Math.round(serviceFeeSYP).toLocaleString('en-US')} SYP</div>
            <div>Delivery Fee: ${Math.round(deliveryFee).toLocaleString('en-US')} SYP</div>
            <div style="margin-top:6px;font-size:19px;">Final Total: ${Math.round(finalTotalSYP).toLocaleString('en-US')} SYP ($${finalTotalUSD.toFixed(2)})</div>
          </div>
          ${additionalNotes ? `<div style="margin-top:14px;font-size:13px;"><strong>Notes:</strong> ${additionalNotes}</div>` : ''}
        </div>
      `;

      document.body.appendChild(container);
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });

      await doc.html(container, {
        x: 16,
        y: 16,
        html2canvas: {
          scale: 0.65,
          useCORS: true,
        },
      });

      document.body.removeChild(container);
      doc.save(`${invoiceNumber}.pdf`);
      toast.success('تم تحميل الفاتورة PDF بنجاح');
    } catch (error) {
      console.error('Failed to generate invoice PDF:', error);
      toast.error('تعذر إنشاء الفاتورة PDF');
    }
  }, [paymentMethod, senderName, senderCallingCode, senderPhone, senderCountry, recipientName, recipientPhone, recipientAddress, cartItems, isFreeDelivery, serviceFeeSYP, originalTotalSYP, membershipDiscountSYP, couponDiscountSYP, selectedTipSYP, finalTotalSYP, finalTotalUSD, additionalNotes]);

  const openWhatsAppSafely = useCallback((url, popupRef = null) => {
    try {
      if (popupRef && !popupRef.closed) {
        popupRef.location.href = url;
        popupRef.focus?.();
        return true;
      }

      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (opened) {
        opened.focus?.();
        return true;
      }

      // Instead of hard-terminating the app by setting window.location.href,
      // return false so the calling code can offer a clickable link or toast.
      return false;
    } catch (error) {
      console.error('openWhatsAppSafely failed:', error);
      return false;
    }
  }, []);

  const generateOrderNumber = useCallback(async () => {
    try {
      const { data } = await supabase.rpc('generate_order_number');
      if (typeof data === 'string' && data.trim()) {
        return data.trim();
      }
    } catch (error) {
      console.warn('Falling back to local order number generation:', error);
    }

    return `WSL-${Date.now().toString().slice(-8)}`;
  }, []);

  // حفظ الطلب في Supabase
  const saveOrderToSupabase = useCallback(async (orderData) => {
    try {
      console.log('💾 saveOrderToSupabase called with:', { paymentMethod: orderData.paymentMethod, totalUSD: orderData.totalUSD, itemCount: orderData.items?.length });
      const generatedOrderNumber = await generateOrderNumber();
      const paymentStatus = (orderData.paymentMethod === 'paypal' && orderData.paypalDetails) ? 'paid' : 'pending';
      // Try dynamic compatibility RPC first.
      let order = null;
      let orderError = null;

      try {
        const rpc = await supabase.rpc('create_compatible_order_v2', {
          p_order: {
            ...orderData,
            orderNumber: generatedOrderNumber,
          },
        });
        if (!rpc.error && rpc.data) {
          order = rpc.data;
          orderError = null;
        } else {
          orderError = rpc.error;
        }
      } catch (rpcError) {
        orderError = rpcError;
      }

      if (order) {
      }

      if (!order && isMissingRpcFunctionError(orderError, 'create_compatible_order_v2')) {
        throw new Error('قاعدة البيانات تحتاج تحديث: شغّل migration 013_create_compatible_order_rpc_v2.sql');
      }

      if (!order && orderError) {
        const isJsonCastError =
          String(orderError?.code || '') === '22P02'
          || String(orderError?.message || '').toLowerCase().includes('invalid input syntax for type json');

        if (isJsonCastError) {
          console.warn('⚠️ RPC failed with JSON cast issue, trying direct insert fallback...', orderError);
          try {
            const { data: authData } = await supabase.auth.getUser();
            const authUser = authData?.user;
            const directPayload = {
              order_number: generatedOrderNumber,
              status: paymentStatus,
              payment_status: paymentStatus === 'paid' ? 'succeeded' : 'pending',
              payment_method: orderData.paymentMethod || 'whatsapp',
              total_amount: Number(orderData.totalUSD || 0),
              total_usd: Number(orderData.totalUSD || 0),
              total_syp: Number(orderData.totalSYP || 0),
              currency: 'USD',
              items: orderData.items,
              sender_details: orderData.sender || {},
              recipient_details: orderData.recipient || {},
              notes: orderData.notes || '',
            };

            if (authUser?.id) {
              directPayload.user_id = authUser.id;
            }

            const { data: insertedOrder, error: directInsertError } = await supabase
              .from('orders')
              .insert([directPayload])
              .select('*')
              .single();

            if (directInsertError) throw directInsertError;
            order = insertedOrder;
            orderError = null;
          } catch (fallbackError) {
            console.error('❌ Direct fallback insert failed:', fallbackError);
            throw orderError;
          }
        } else {
          console.error('❌ create_compatible_order_v2 failed:', orderError);
          throw orderError;
        }
      }

      if (orderError) {
        console.error('❌ خطأ في حفظ الطلب:', orderError);
        throw orderError;
      }


      // Safety net: If the RPC didn't save items to the 'items' column, do it now
      if (!order.items || (Array.isArray(order.items) && order.items.length === 0)) {
        try {
          const { error: updateError } = await supabase
            .from('orders')
            .update({ items: orderData.items })
            .eq('id', order.id);
          if (updateError) {
            console.warn('⚠️ تعذر تحديث عمود items مباشرة:', updateError);
          } else {
            order.items = orderData.items;
          }
        } catch (e) {
          console.warn('⚠️ خطأ في تحديث items:', e);
        }
      }

      // حفظ عناصر الطلب
      const orderItems = orderData.items.map(item => ({
        order_id: order.id,
        item_name: item.name_ar || item.name,
        item_id: item.id || crypto.randomUUID(),
        item_type: item.item_type || 'product',
        quantity: item.quantity,
        unit_price: Number(item.priceUSD || 0),
        total_price: Number(item.priceUSD || 0) * (item.quantity || 1),
        item_image: item.image_url || item.image
      }));

      const { data: items, error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItems);

      if (itemsError) {
        console.warn('⚠️ تعذر حفظ عناصر الطلب في order_items، تم حفظ الطلب الرئيسي فقط:', itemsError);
      } else {
      }

      // ===== حفظ الهدايا النقدية (إذا كانت موجودة) =====
      const cashGifts = orderData.items?.filter(item => 
        String(item.item_type || '').toLowerCase() === 'cash_gift'
      ) || [];

      if (cashGifts.length > 0) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const userId = session?.user?.id || null;
          const userEmail = session?.user?.email || orderData.sender?.email || currentUserEmail || 'guest@example.com';

          // حفظ كل هدية نقدية
          for (const gift of cashGifts) {
            try {
              // ✅ الحساب الصحيح: إذا كانت العملة الأصلية USD، استخدم original_amount
              // وإلا، تحويل من SYP إلى USD
              let giftAmountUSD = 0;
              let giftAmountSYP = gift.price || 0;
              
              // إذا كانت العملة الأصلية USD، استخدم original_amount مباشرة
              if (gift.original_currency === 'USD') {
                giftAmountUSD = gift.original_amount || 0;
                giftAmountSYP = giftAmountUSD * exchangeRate;
              } else {
                // إذا كانت SYP، قسّم على سعر الصرف
                giftAmountUSD = giftAmountSYP / exchangeRate;
              }
              
              const { data: savedGift, error: giftError } = await supabase.rpc('create_cash_gift', {
                p_order_id: order.id,
                p_user_id: userId,
                p_email: userEmail,
                p_sender_name: orderData.sender?.name || 'غير محدد',
                p_sender_phone: orderData.sender?.phone || '',
                p_sender_country: orderData.sender?.country || 'uae',
                p_recipient_name: orderData.recipient?.name || 'غير محدد',
                p_recipient_phone: orderData.recipient?.phone || '',
                p_recipient_address: orderData.recipient?.address || '',
                p_gift_amount_usd: Math.round(giftAmountUSD * 100) / 100, // دقيق لمنزلتين
                p_gift_amount_syp: giftAmountSYP,
                p_gift_currency: gift.currency || 'USD',
                p_original_amount: gift.original_amount || gift.quantity || 1,
                p_exchange_rate: exchangeRate,
                p_gift_message: gift.description || 'هدية نقدية',
                p_delivery_time: orderData.deliveryTime || null
              });

              if (giftError) {
                console.warn('⚠️ تعذر حفظ الهدية النقدية، لكن الطلب تم حفظه:', giftError);
              } else {
              }
            } catch (giftSaveError) {
              console.warn('⚠️ خطأ في حفظ الهدية النقدية:', giftSaveError);
              // لا نرمي الخطأ لأن الطلب الرئيسي تم حفظه بنجاح
            }
          }
        } catch (giftProcessError) {
          console.warn('⚠️ خطأ في معالجة الهدايا النقدية:', giftProcessError);
        }
      }

      // Notify supervisors/admins for every newly created order,
      // regardless of whether it came from PayPal, WhatsApp, or COD.
      try {
        await notifyAdminUsers('new_order_created', order, {
          paymentMethod: orderData.paymentMethod,
        });
      } catch (notifyError) {
        console.warn('notifyAdminUsers warning:', notifyError);
      }

      return order;
    } catch (error) {
      console.error('❌ فشل في حفظ الطلب:', error);
      throw error;
    }
  }, [generateOrderNumber, exchangeRate, currentUserEmail]);

  const persistPayPalOrderWithRetry = useCallback(async (orderData) => {
    const captureId = orderData.paypalCaptureId;

    if (captureId && isPayPalCaptureSaved(captureId)) {
      console.log('PayPal capture already persisted, skipping duplicate save:', captureId);
      return { duplicated: true };
    }

    let lastError = null;
    for (let attempt = 1; attempt <= MAX_PAYPAL_SAVE_RETRIES; attempt += 1) {
      try {
        const savedOrder = await saveOrderToSupabase(orderData);
        markPayPalCaptureSaved(captureId);
        return { savedOrder };
      } catch (error) {
        lastError = error;
        console.warn(`PayPal order save attempt ${attempt} failed`, error);
      }
    }

    throw lastError || new Error('Unable to persist PayPal order');
  }, [isPayPalCaptureSaved, markPayPalCaptureSaved, saveOrderToSupabase]);

  useEffect(() => {
    const retryPendingPayPalOrders = async () => {
      const pendingOrders = getPendingPayPalOrders();
      if (!pendingOrders.length) return;

      const stillPending = [];
      for (const pendingOrder of pendingOrders) {
        try {
          await persistPayPalOrderWithRetry(pendingOrder);
          await sendOrderToBase44(pendingOrder);
        } catch (error) {
          stillPending.push(pendingOrder);
        }
      }

      savePendingPayPalOrders(stillPending);
      if (pendingOrders.length > 0 && stillPending.length === 0) {
        toast.success('تمت مزامنة طلبات PayPal المدفوعة بنجاح');
      }
    };

    retryPendingPayPalOrders();
  }, [getPendingPayPalOrders, persistPayPalOrderWithRetry, savePendingPayPalOrders]);

  // إرسال الطلب إلى Base44 Admin
  const sendOrderToBase44 = useCallback(async (orderData) => {
    try {

      // إنشاء طلب في Base44
      const base44Order = {
        customer_name: orderData.sender.name,
        customer_email: orderData.sender.email,
        customer_phone: orderData.sender.phone,
        delivery_address: orderData.recipient.address,
        recipient_name: orderData.recipient.name,
        recipient_phone: orderData.recipient.phone,
        total_amount: orderData.totalSYP,
        currency: 'SYP',
        payment_method: orderData.paymentMethod,
        items: orderData.items.map(item => ({
          product_id: item.id,
          product_name: item.name_ar || item.name,
          quantity: item.quantity,
          price: item.priceSYP,
          total: item.priceSYP * item.quantity
        })),
        notes: orderData.notes || '',
        delivery_time: orderData.deliveryTime || null
      };

      // إرسال إلى Base44 API (افتراضياً)
      const response = await fetch('/api/base44/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(base44Order)
      });

      if (!response.ok) {
        console.warn('⚠️ تحذير: فشل في إرسال الطلب إلى Base44، لكن الطلب محفوظ محلياً');
      } else {
        const result = await response.json();
      }
    } catch (error) {
      console.warn('⚠️ تحذير: فشل في إرسال الطلب إلى Base44:', error.message);
    }
  }, []);

  // Handle checkout
  const handleCheckout = useCallback(async () => {
    console.log('🛒 handleCheckout called, paymentMethod:', paymentMethod, 'items:', cartItems.length);
    // ===================== ✅ SECURITY CHECK: EMPTY CART =====================
    if (cartItems.length === 0) {
      console.log('❌ Cart is empty');
      toast.error('السلة فارغة');
      return;
    }

    // ===================== ✅ SECURITY: VALIDATE DELIVERY INFO =====================
    if (insideSyria) {
      // داخل سوريا: بيانات المستقبل فقط
      if (!recipientName?.trim() || !recipientPhone?.trim() || !recipientAddress?.trim()) {
        console.log('❌ Missing recipient info (Syria):', { recipientName, recipientPhone, recipientAddress });
        toast.error('يرجى إدخال اسم المستقبل والرقم والعنوان');
        return;
      }
    } else {
      // خارج سوريا: بيانات المرسل والمستقبل
      if (!senderName?.trim() || !senderPhone?.trim() || !recipientName?.trim() || 
          !recipientPhone?.trim() || !recipientAddress?.trim()) {
        console.log('❌ Missing delivery info (outside Syria):', { senderName, senderPhone, recipientName, recipientPhone, recipientAddress });
        toast.error('يرجى ملء جميع بيانات التوصيل (المرسل والمستقبل)');
        return;
      }
    }

    setIsCheckingOut(true);

    try {
      // ===================== ✅ SECURITY: VALIDATE PAYMENT METHOD =====================
      if (!paymentMethod || !['paypal', 'wallet', 'whatsapp', 'shared_cart'].includes(paymentMethod)) {
        console.log('❌ Invalid payment method:', paymentMethod);
        await logSuspiciousPaymentAttempt(supabase, currentUserEmail, 'invalid_payment_method', { paymentMethod });
        toast.error('طريقة دفع غير صحيحة');
        return;
      }

      // ===================== ✅ SECURITY: AMOUNT VALIDATION =====================
      if (finalTotalUSD <= 0) {
        console.log('❌ Invalid amount:', finalTotalUSD);
        await logSuspiciousPaymentAttempt(supabase, currentUserEmail, 'invalid_amount', { amount: finalTotalUSD });
        toast.error('المبلغ يجب أن يكون أكبر من صفر');
        return;
      }

      const normalizedTipSYP = selectedTipSYP > 0 && selectedTipSYP < 10 ? 10 : selectedTipSYP;
      if (normalizedTipSYP !== selectedTipSYP) {
        setSelectedTipSYP(normalizedTipSYP);
        setCustomTip(normalizedTipSYP);
      }

      // ===================== ✅ SECURITY: PREVENT DUPLICATE ORDERS =====================
      const orderHash = btoa(JSON.stringify({
        items: cartItems.map(i => `${i.id}-${i.quantity}`),
        recipient: recipientPhone,
        amount: finalTotalUSD,
      }));
      
      const { isDuplicate, error: dupError } = checkDuplicateOrder(currentUserEmail || 'guest', orderHash);
      if (isDuplicate) {
        console.log('❌ Duplicate order blocked:', dupError);
        toast.error(dupError);
        return;
      }

      // جمع بيانات الطلب - استخدام state variables
      const orderData = {
        sender: {
          name: insideSyria ? (recipientName?.trim() || 'غير محدد') : (senderName?.trim() || 'غير محدد'),
          email: currentUserEmail || 'guest@example.com',
          phone: insideSyria ? (recipientPhone?.trim() || '') : (senderPhone?.trim() || ''),
          country: insideSyria ? 'syria' : (senderCountry || 'uae')
        },
        recipient: {
          name: recipientName?.trim() || 'غير محدد',
          phone: recipientPhone?.trim() || '',
          address: recipientAddress?.trim() || '',
          delivery_time: deliveryTime || null
        },
        items: cartItems.map(item => ({
          id: item.id,
          name: item.name_ar || item.name,
          name_ar: item.name_ar || item.name,
          quantity: Math.floor(item.quantity), // ✅ التأكد من أن الكمية عدد صحيح
          priceSYP: Math.max(0, item.customer_price || item.price || 0),
          priceUSD: Math.max(0, (item.customer_price || item.price || 0) / exchangeRate),
          image_url: item.image_url || item.image
        })),
        totalSYP: finalTotalSYP,
        totalUSD: finalTotalUSD,
        membershipDiscountSYP: Math.max(0, membershipDiscountSYP),
        paymentMethod: paymentMethod,
        notes: (additionalNotes || '').substring(0, 500), // ✅ تحديد طول الملاحظات
        deliveryTime: deliveryTime || null,
        tip: normalizedTipSYP,
        coupon: appliedCoupon?.code
      };

      // ===================== ✅ SECURITY: VALIDATE ORDER STRUCTURE =====================
      const validation = validatePaymentBeforeOrder(orderData);
      console.log('🔍 Validation result:', validation);
      if (!validation.isValid) {
        console.log('❌ Order validation failed:', validation.errors);
        await logSuspiciousPaymentAttempt(supabase, currentUserEmail, 'invalid_order_structure', { errors: validation.errors });
        toast.error(validation.errors[0] || 'بيانات الطلب غير كاملة');
        return;
      }
      console.log('✅ Validation passed, proceeding with:', paymentMethod);

      if (paymentMethod === 'paypal') {
        // ===================== ✅ PAYPAL PAYMENT =====================
        console.log('💳 Opening PayPal...');
        setShowPayPal(true);
      } else if (paymentMethod === 'wallet') {
        // ===================== ✅ WALLET PAYMENT =====================
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.user) {
            toast.error('يجب تسجيل الدخول أولاً');
            return;
          }

          // ===================== ✅ SECURITY: VALIDATE WALLET BALANCE =====================
          const walletValidation = validateWalletPayment(walletBalance, finalTotalUSD);
          if (!walletValidation.isValid) {
            await logSuspiciousPaymentAttempt(supabase, session.user.id, 'insufficient_wallet', { 
              required: finalTotalUSD,
              available: walletBalance 
            });
            toast.error(walletValidation.errors[0], { duration: 5000 });
            return;
          }

          // Save order first
          const savedOrder = await saveOrderToSupabase({ ...orderData, paymentMethod: 'wallet' });

          // ===================== ✅ FINAL AMOUNT CHECK =====================
          const amountCheck = validateAmountMatch(orderData.totalUSD, finalTotalUSD);
          if (!amountCheck.isValid) {
            await logSuspiciousPaymentAttempt(supabase, session.user.id, 'amount_mismatch', amountCheck);
            toast.error(amountCheck.error);
            return;
          }

          // Debit wallet
          const { data: payResult, error: payError } = await supabase.rpc('wallet_pay', {
            p_user_id: session.user.id,
            p_amount_usd: finalTotalUSD,
            p_order_ref: savedOrder?.order_number || savedOrder?.id || null,
          });

          if (payError) throw payError;

          if (payResult?.success) {
            // ===================== ✅ MARK ORDER AS CREATED =====================
            markOrderCreated(currentUserEmail || 'guest', orderHash);
            
            setWalletBalance(payResult.new_balance);
            clearCart?.();
            localStorage.removeItem('wasel_shared_cart_session');
            
            // ===== تحديث الطلبات المجانية =====
            if (isFreeOrderEligible && freeOrdersRemaining > 0) {
              try {
                const { data, error } = await supabase.rpc('decrement_free_orders', {
                  p_user_id: session.user.id,
                  p_email: session.user.email
                });

                if (!error && data && data.length > 0) {
                  const remaining = data[0].free_orders_remaining || 0;
                  const message = data[0].message || '';
                  setFreeOrdersRemaining(remaining);
                  toast.info(message, { duration: 4000 });
                }
              } catch (err) {
                console.warn('Could not update free orders:', err);
              }
            }
            
            // Show payment success animation
            setShowPaymentSuccessAnimation(true);
            setPaymentSuccessMessage(`تم الدفع بنجاح من المحفظة! رصيدك المتبقي: ${Number(payResult.new_balance).toFixed(2)}$`);
            toast.success(`${setPaymentSuccessMessage} ✅`, { duration: 5000 });
            
            // Navigate to orders after animation completes (2.5s)
            setTimeout(() => {
              navigate('/MyOrders', { state: { showInvoicePrompt: true, invoiceOrderId: savedOrder?.id || null } });
            }, 2500);
          } else {
            const errMsg = payResult?.error === 'insufficient_balance'
              ? `رصيد غير كافٍ. رصيدك: ${payResult.balance}$ والمطلوب: ${payResult.required}$`
              : 'فشل الدفع من المحفظة';
            toast.error(errMsg);
          }
        } catch (walletErr) {
          console.error('Wallet pay error:', walletErr);
          toast.error('حدث خطأ أثناء الدفع من المحفظة');
        }
      } else if (paymentMethod === 'whatsapp') {
        // حفظ طلبات واتساب مباشرة
        console.log('📨 WhatsApp flow: saving order...');
        const savedOrder = await saveOrderToSupabase(orderData);
        console.log('✅ Order saved:', savedOrder);
        await sendOrderToBase44(orderData);

        // فتح الواتساب مع الرسالة المشفرة بشكل آمن
        const message = createWhatsAppMessage({ orderNumber: savedOrder?.order_number || savedOrder?.id });
        const encodedMessage = encodeURIComponent(message);
        const whatsappUrl = `${WHATSAPP_BASE_LINK}?text=${encodedMessage}`;

        // Clear cart first so we don't lose state if page unloads
        clearCart?.();
        localStorage.removeItem('wasel_shared_cart_session');
        
        // ===== تحديث الطلبات المجانية =====
        if (isFreeOrderEligible && freeOrdersRemaining > 0) {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            const userId = session?.user?.id;
            const userEmail = session?.user?.email || currentUserEmail;

            const { data, error } = await supabase.rpc('decrement_free_orders', {
              p_user_id: userId || null,
              p_email: userEmail
            });

            if (!error && data && data.length > 0) {
              const remaining = data[0].free_orders_remaining || 0;
              const message = data[0].message || '';
              setFreeOrdersRemaining(remaining);
              toast.info(message, { duration: 4000 });
            }
          } catch (err) {
            console.warn('Could not update free orders:', err);
          }
        }
        
        // Show payment success animation
        setShowPaymentSuccessAnimation(true);
        setPaymentSuccessMessage('تم استقبال طلبك! جاري إرسال التفاصيل...');
        
        // Attempt to open WhatsApp popup synchronously to keep user activation
        const opened = openWhatsAppSafely(whatsappUrl);
        
        // Navigate to orders after animation (2.5s)
        setTimeout(() => {
          navigate('/MyOrders', { state: { showInvoicePrompt: true, invoiceOrderId: savedOrder?.id || null } });
        }, 2500);
        
        if (!opened) {
          try {
            navigator.clipboard.writeText(message);
          } catch {}
          toast('لإكمال الطلب، يرجى إرسال الرسالة عبر واتساب', {
            action: {
              label: 'فتح واتساب',
              onClick: () => window.location.href = whatsappUrl
            },
            duration: 10000
          });
        } else {
          toast.success('تم حفظ الطلب وارساله ✅');
        }
      } else if (paymentMethod === 'shared_cart') {
        // مشاركة السلة مع رسوم التوصيل $3 + رسوم الخدمة
        console.log('🔗 Shared cart flow...');
        await handleShareCart();
      }
    } catch (error) {
      console.error('❌ خطأ في حفظ الطلب:', error?.message || error, error);
      toast.error(error?.message || 'حدث خطأ في حفظ الطلب، حاول مرة أخرى');
    } finally {
      console.log('🏁 handleCheckout finished');
      setIsCheckingOut(false);
    }
  }, [cartItems, paymentMethod, createWhatsAppMessage, saveOrderToSupabase, sendOrderToBase44, finalTotalSYP, finalTotalUSD, selectedTipSYP, appliedCoupon, membershipDiscountSYP, clearCart, navigate, senderName, senderPhone, recipientName, recipientAddress, senderCountry, recipientPhone, additionalNotes, deliveryTime, exchangeRate, currentUserEmail, openWhatsAppSafely, insideSyria, walletBalance, handleShareCart]);

  // PayPal Success Handler
  const handlePayPalSuccess = useCallback(async (details) => {

    try {
      const normalizedTipSYP = selectedTipSYP > 0 && selectedTipSYP < 10 ? 10 : selectedTipSYP;
      if (normalizedTipSYP !== selectedTipSYP) {
        setSelectedTipSYP(normalizedTipSYP);
        setCustomTip(normalizedTipSYP);
      }

      const paypalCaptureId = extractPayPalCaptureId(details);

      // جمع بيانات الطلب للحفظ - استخدام state variables
      const orderData = {
        sender: {
          name: senderName || 'غير محدد',
          email: currentUserEmail || 'guest@example.com',
          phone: senderPhone || '',
          country: senderCountry || 'uae'
        },
        recipient: {
          name: recipientName || 'غير محدد',
          phone: recipientPhone || '',
          address: recipientAddress || '',
            delivery_time: deliveryTime || null
          },
        items: cartItems.map(item => ({
          id: item.id,
          name: item.name_ar || item.name,
          name_ar: item.name_ar || item.name,
          quantity: item.quantity,
          priceSYP: item.customer_price || item.price || 0,
          priceUSD: ((item.customer_price || item.price || 0) / exchangeRate),
          image_url: item.image_url || item.image
        })),
        totalSYP: finalTotalSYP,
        totalUSD: finalTotalUSD,
        membershipDiscountSYP,
        paymentMethod: 'paypal',
        notes: additionalNotes || '',
        deliveryTime: deliveryTime || null,
        tip: normalizedTipSYP,
        coupon: appliedCoupon?.code,
        paypalCaptureId,
        paypalDetails: details // حفظ تفاصيل الدفع
      };

      // حفظ الطلب المدفوع مع إعادة محاولة داخلية
      const persisted = await persistPayPalOrderWithRetry(orderData);
      const savedOrderId = persisted?.savedOrder?.id || null;

      // إرسال الطلب إلى Base44 Admin
      await sendOrderToBase44(orderData);

      // ===== تحديث الطلبات المجانية =====
      if (isFreeOrderEligible && freeOrdersRemaining > 0) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const userId = session?.user?.id;
          const email = session?.user?.email || currentUserEmail;

          const { data, error } = await supabase.rpc('decrement_free_orders', {
            p_user_id: userId || null,
            p_email: email
          });

          if (!error && data && data.length > 0) {
            const remaining = data[0].free_orders_remaining || 0;
            const message = data[0].message || '';
            setFreeOrdersRemaining(remaining);
            toast.info(message, { duration: 4000 });
          }
        } catch (err) {
          console.warn('Could not update free orders:', err);
        }
      }

      // Show payment success animation
      setShowPaymentSuccessAnimation(true);
      setPaymentSuccessMessage('تم الدفع بنجاح! جاري حفظ طلبك...');
      toast.success('تم الدفع بنجاح وحفظ الطلب! شكراً لك 🎉');
      clearCart?.();
      localStorage.removeItem('wasel_shared_cart_session');
      setShowPayPal(false);
      
      // Navigate after animation (2.5s)
      setTimeout(() => {
        navigate('/MyOrders', { state: { showInvoicePrompt: true, invoiceOrderId: savedOrderId } });
      }, 2500);
    } catch (error) {
      console.error('❌ خطأ في حفظ الطلب بعد الدفع:', error);
      const paypalCaptureId = extractPayPalCaptureId(details);
      const pendingOrders = getPendingPayPalOrders();
      const alreadyQueued = pendingOrders.some((item) => item.paypalCaptureId && item.paypalCaptureId === paypalCaptureId);

      if (!alreadyQueued) {
        const fallbackOrder = {
          sender: {
            name: senderName || 'غير محدد',
            email: currentUserEmail || 'guest@example.com',
            phone: senderPhone || '',
            country: senderCountry || 'uae'
          },
          recipient: {
            name: recipientName || 'غير محدد',
            phone: recipientPhone || '',
            address: recipientAddress || '',
            delivery_time: deliveryTime || null
          },
          items: cartItems.map(item => ({
            id: item.id,
            name: item.name_ar || item.name,
            name_ar: item.name_ar || item.name,
            quantity: item.quantity,
            priceSYP: item.customer_price || item.price || 0,
            priceUSD: ((item.customer_price || item.price || 0) / exchangeRate),
            image_url: item.image_url || item.image
          })),
          totalSYP: finalTotalSYP,
          totalUSD: finalTotalUSD,
          membershipDiscountSYP,
          paymentMethod: 'paypal',
          notes: additionalNotes || '',
          deliveryTime: deliveryTime || null,
          tip: selectedTipSYP,
          coupon: appliedCoupon?.code,
          paypalCaptureId,
          paypalDetails: details
        };
        savePendingPayPalOrders([...pendingOrders, fallbackOrder]);
      }

      toast.error('تم الدفع بنجاح وسيتم إعادة مزامنة الطلب تلقائيا خلال لحظات.');
      // لا نلغي السلة هنا لأن الدفع نجح
    }
  }, [cartItems, finalTotalSYP, finalTotalUSD, selectedTipSYP, appliedCoupon, membershipDiscountSYP, sendOrderToBase44, clearCart, navigate, extractPayPalCaptureId, persistPayPalOrderWithRetry, getPendingPayPalOrders, savePendingPayPalOrders, senderName, senderPhone, senderCountry, recipientName, recipientPhone, recipientAddress, additionalNotes, deliveryTime, exchangeRate, currentUserEmail]);

  // PayPal Error Handler
  const handlePayPalError = useCallback((error) => {
    console.error('❌ PayPal error:', error);
    toast.error('فشل الدفع، حاول مرة أخرى');
  }, []);

  // Empty state
  if (!cartItems || cartItems.length === 0) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] font-['Cairo']">
        <EmptyCart onNavigate={() => navigate('/')} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-['Cairo'] pb-32" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 7rem)' }}>
      {/* Header */}
      <motion.div 
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between z-40 shadow-sm"
      >
        <motion.button 
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => navigate(-1)} 
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <ArrowRight className="w-5 h-5 text-gray-700" />
        </motion.button>
        <h1 className="font-bold text-lg text-gray-900" dir="rtl">سلة الطلبات ({cartItems.length})</h1>
        <div className="w-10" />
      </motion.div>

      <div className="px-4 py-4">
        {/* Free Delivery Progress - بالليرة */}
        <FreeDeliveryProgress 
          currentTotalSYP={originalTotalSYP} 
          thresholdSYP={FREE_DELIVERY_THRESHOLD_SYP} 
        />

        {/* Cart Items */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl overflow-hidden shadow-sm"
        >
          <AnimatePresence>
            {cartItems.map((item) => (
              <CartItemRow
                key={item.id}
                item={item}
                onQuantityChange={handleQuantityChange}
                onRemove={handleRemoveItem}
                onViewDetails={handleViewDetails}
                isUpdating={isUpdating}
                exchangeRate={exchangeRate}
              />
            ))}
          </AnimatePresence>
        </motion.div>

        {/* Upsell - من Base44 */}
        <UpsellCarousel onAddItem={handleAddUpsellItem} />

        {/* Envelope Gift - إضافة هدية نقدية */}
        <EnvelopeGift
          onAddToCart={(giftData) => {
            addToCart(giftData);
            toast.success('تمت إضافة الهدية النقدية للسلة! 🎁');
          }}
          language="ar"
          exchangeRate={exchangeRate}
        />

        {/* Tip - بالليرة السورية */}
        <TipSection
          selectedTipSYP={selectedTipSYP}
          onTipChange={setSelectedTipSYP}
          customTip={customTip}
          onCustomTipChange={setCustomTip}
        />

        {/* Coupon */}
        <CouponInput
          appliedCoupon={appliedCoupon}
          onApply={handleApplyCoupon}
          onRemove={() => setAppliedCoupon(null)}
          isLoading={couponLoading}
          showAnimation={showCouponAnimation}
        />

        {/* Payment Method - PayPal + واتساب */}
        <PaymentMethodSelector
          selected={paymentMethod}
          onChange={setPaymentMethod}
          allowOnlinePayment={!insideSyria}
          walletBalance={walletBalance}
          insideSyria={insideSyria}
        />

        {/* Address Form - مطلوب لكلٍ من واتساب و PayPal و المحفظة */}
        {(paymentMethod === 'whatsapp' || paymentMethod === 'paypal' || paymentMethod === 'wallet' || paymentMethod === 'shared_cart') && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl p-4 mt-4"
          >
            <div className="flex items-center gap-2 mb-6">
              <MessageCircle className="w-5 h-5 text-[#25D366]" />
              <h3 className="font-bold text-gray-900 text-lg" dir="rtl">تفاصيل التوصيل المطلوبة</h3>
            </div>

            {/* Sender Information (outside Syria only) */}
            {!insideSyria && (
            <div className="mb-6">
              <h4 className="font-bold text-gray-900 mb-3 text-base" dir="rtl">بيانات المرسل</h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" dir="rtl">الاسم الكامل *</label>
                  <input
                    type="text"
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    placeholder="أدخل اسمك"
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#25D366] focus:ring-1 focus:ring-[#25D366] transition-all"
                    dir="rtl"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" dir="rtl">الدولة *</label>
                  <select 
                    value={senderCountry}
                    onChange={(e) => setSenderCountry(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#25D366] focus:ring-1 focus:ring-[#25D366] transition-all" 
                    dir="rtl"
                  >
                    {getCountriesArabicNames().map(country => (
                      <option key={country} value={country}>{country}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" dir="rtl">رقم الواتساب *</label>
                  <div className="flex gap-2">
                    <span className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 whitespace-nowrap">
                      {senderCallingCode}
                    </span>
                    <input
                      type="tel"
                      value={senderPhone}
                      onChange={(e) => setSenderPhone(e.target.value)}
                      placeholder="5024 0651"
                      className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#25D366] focus:ring-1 focus:ring-[#25D366] transition-all"
                      dir="ltr"
                    />
                  </div>
                </div>
              </div>
            </div>
            )}

            {/* Recipient Information */}
            <div className="mb-6">
              <h4 className="font-bold text-gray-900 mb-3 text-base" dir="rtl">بيانات المستلم</h4>
              {sharedCartMode && (
                <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm text-center font-bold relative">
                  هذا الطلب لـ {recipientName} (سلة مشتركة) 🕊️
                  <button onClick={handleClearSharedCart} className="absolute left-2 top-2 text-xs text-red-500 underline">إلغاء</button>
                </div>
              )}
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" dir="rtl">اسم المستلم *</label>
                  <input
                    type="text"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="أدخل اسم المستقبل"
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#25D366] focus:ring-1 focus:ring-[#25D366] transition-all"
                    dir="rtl"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" dir="rtl">رقم الهاتف *</label>
                  <input
                    type="tel"
                    value={recipientPhone}
                    onChange={(e) => setRecipientPhone(e.target.value)}
                    placeholder="أرقام الهاتف"
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#25D366] focus:ring-1 focus:ring-[#25D366] transition-all"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" dir="rtl">العنوان بالتفصيل *</label>
                  <textarea
                    rows="3"
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                    placeholder="المدينة، الحي، الشارع، البناية"
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#25D366] focus:ring-1 focus:ring-[#25D366] transition-all resize-none"
                    dir="rtl"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleSaveDeliveryAddress}
                    className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-semibold hover:bg-[#1da851] transition-colors"
                  >
                    حفظ العنوان
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/MyAddresses')}
                    className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors"
                  >
                    اختر من عناويني
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const selectedAddress = getSelectedAddress();
                      if (!selectedAddress?.street) {
                        toast.error('لا يوجد عنوان مختار حالياً في صفحة عناويني');
                        return;
                      }

                      setRecipientName(selectedAddress.label || '');
                      setRecipientPhone(selectedAddress.phone || '');
                      setRecipientAddress(selectedAddress.street || '');
                      setSenderName(selectedAddress.sender_name || senderName || '');
                      setSenderPhone(selectedAddress.sender_phone || senderPhone || '');
                      setSenderCountry(selectedAddress.sender_country || senderCountry || 'الإمارات');
                      toast.success('تم تحميل العنوان المختار');
                    }}
                    className="px-4 py-2 bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D4ED8] rounded-lg text-sm font-semibold hover:bg-[#DBEAFE] transition-colors"
                  >
                    استخدام العنوان المختار
                  </button>
                  {addressSavedManually && (
                    <span className="text-xs text-green-700" dir="rtl">تم الحفظ بنجاح</span>
                  )}
                </div>
              </div>
            </div>

            {/* Delivery Time (Optional) */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2" dir="rtl">وقت التوصيل (اختياري)</label>
              <input
                type="datetime-local"
                value={deliveryTime}
                onChange={(e) => setDeliveryTime(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#25D366] focus:ring-1 focus:ring-[#25D366] transition-all"
                dir="rtl"
              />
            </div>

            {/* Additional Notes */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2" dir="rtl">ملاحظات إضافية</label>
              <textarea
                rows="3"
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                placeholder="أي تفاصيل أخرى تود إضافتها..."
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#25D366] focus:ring-1 focus:ring-[#25D366] transition-all resize-none"
                dir="rtl"
              />
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-800 leading-relaxed" dir="rtl">
                لن نقوم بالكشف عن اسم المرسل أو السعر للمستلم
              </p>
            </div>
          </motion.div>
        )}

        {/* ===== إشعار الطلبات المجانية ===== */}
        <AnimatePresence>
          {showFreeOrderNotification && isFreeOrderEligible && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="mb-4 rounded-2xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-yellow-50 p-4 overflow-hidden"
            >
              <div className="flex items-start gap-3">
                <motion.div
                  animate={{ rotate: [0, 10, -10, 0] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="shrink-0"
                >
                  <Bell className="w-6 h-6 text-amber-600" />
                </motion.div>
                <div className="flex-1" dir="rtl">
                  <h4 className="font-bold text-amber-900 text-base mb-1">
                    {freeOrderNotificationMessage}
                  </h4>
                  <p className="text-xs text-amber-800">
                    {isFreeOrderEligible && freeOrdersRemaining > 0 && (
                      <>
                        طلباتك المجانية المتبقية: <span className="font-bold">{freeOrdersRemaining}</span>
                        <br />
                        {freeOrdersRemaining === 1 && '🚀 استمتع بآخر طلب مجاني!'}
                        {freeOrdersRemaining === 2 && '⭐ استمتع بطلبين مجانيين آخرين!'}
                        {freeOrdersRemaining === 3 && '🎁 استمتع بثلاث طلبات مجانية كاملة!'}
                      </>
                    )}
                  </p>
                </div>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowFreeOrderNotification(false)}
                  className="shrink-0 text-amber-600 hover:text-amber-800"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Order Summary - المجموع الفرعي = مجموع الأسعار المعروضة */}
        <OrderSummary
          displayedSubtotalSYP={displayedSubtotalSYP}
          originalTotalSYP={originalTotalSYP}
          membershipDiscountSYP={membershipDiscountSYP}
          tipSYP={selectedTipSYP}
          couponDiscountSYP={couponDiscountSYP}
          isFreeDelivery={isFreeDelivery}
          appliedCouponCode={appliedCoupon?.code}
          paymentMethod={paymentMethod}
          exchangeRate={exchangeRate}
          insideSyria={insideSyria}
          isFreeOrderEligible={isFreeOrderEligible}
        />

        {insideSyria && (
          <div className="mt-4 rounded-2xl border border-[#A7F3D0] bg-gradient-to-br from-[#ECFDF5] to-[#F0FDFA] p-4" dir="rtl">
            <h4 className="font-extrabold text-[#065F46] text-sm mb-1">شارك سلتك مع أحبابك 🕊️</h4>
              <p className="text-xs text-[#047857] leading-relaxed">
                وفرنا لك بيئة آمنة تتيح لمن تحب استكمال طلبك بكل سهولة وبدون تعقيد. بمجرد الدفع سيصلك إشعار وتتغير حالة الطلب.
              </p>
          </div>
        )}

        {insideSyria && (
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={handleShareCart}
            disabled={creatingCartShareLink}
            className="w-full mt-3 h-12 rounded-2xl border-2 border-[#059669] text-[#065F46] bg-white font-bold flex items-center justify-center gap-2 hover:bg-[#ECFDF5]"
          >
            {creatingCartShareLink ? <Loader2 className="w-5 h-5 animate-spin" /> : <Share2 className="w-5 h-5" />}
            {creatingCartShareLink ? 'جارٍ إنشاء الرابط...' : 'مشاركة السلة'}
            <Copy className="w-4 h-4 opacity-70" />
          </motion.button>
        )}

        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={handleDownloadInvoicePdf}
          className="w-full mt-3 h-12 rounded-2xl border-2 border-[#1D4ED8] text-[#1D4ED8] bg-white font-bold flex items-center justify-center gap-2 hover:bg-[#EFF6FF]"
        >
          <FileDown className="w-5 h-5" />
          تحميل الفاتورة PDF
        </motion.button>

        {/* PayPal Modal - يظهر كـ modal بدلاً من الصفحة الجديدة على الموبايل */}
        <PayPalModal
          isOpen={showPayPal && paymentMethod === 'paypal' && !insideSyria}
          onClose={() => setShowPayPal(false)}
          amount={finalTotalUSD}
          onSuccess={handlePayPalSuccess}
          onError={handlePayPalError}
          language="ar"
        />

        {/* Security Badge */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="flex items-center justify-center gap-2 mt-4 text-xs text-gray-500"
        >
          <Shield className="w-4 h-4" />
          <span dir="rtl">دفع آمن ومشفر 100%</span>
        </motion.div>
      </div>

      {/* PayPal Payment Button Section */}
      {paymentMethod === 'paypal' && !insideSyria && (
        <div className="max-w-6xl mx-auto px-4 pb-8 mt-4">
          {(!senderName || !senderPhone || !recipientName || !recipientPhone || !recipientAddress) ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm mb-4" dir="rtl">
              يرجى إكمال بيانات التوصيل أعلاه (اسم المرسل، رقم الواتساب، اسم المستلم، العنوان) قبل الدفع عبر PayPal.
            </div>
          ) : (
            <AnimatePresence>
              {isCheckingOut ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex flex-col items-center justify-center gap-4 py-8 bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl border border-blue-200 mb-4"
                >
                  <SmartLottie
                    animationPath={ANIMATION_PRESETS.paymentProcessing.path}
                    width={100}
                    height={100}
                    trigger="immediate"
                    loop={true}
                  />
                  <p className="text-blue-900 font-bold text-lg">معالجة الدفع...</p>
                  <p className="text-blue-700 text-sm">يرجى الانتظار حتى يتم الاتصال بخادم PayPal</p>
                </motion.div>
              ) : (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={handleCheckout}
                  className="w-full h-12 bg-[#003087] text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#002566] transition-all shadow-lg"
                >
                  <CreditCard className="w-5 h-5" />
                  الدفع الآن عبر PayPal
                </motion.button>
              )}
            </AnimatePresence>
          )}
        </div>
      )}

      {paymentMethod === 'whatsapp' && (
        <div className="max-w-6xl mx-auto px-4 pb-8">
          <AnimatePresence>
            {isCheckingOut ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex flex-col items-center justify-center gap-4 py-8 bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-200 mb-4"
              >
                <SmartLottie
                  animationPath={ANIMATION_PRESETS.paymentProcessing.path}
                  width={100}
                  height={100}
                  trigger="immediate"
                  loop={true}
                />
                <p className="text-green-700 font-bold text-lg">معالجة الطلب...</p>
                <p className="text-green-600 text-sm">يرجى الانتظار حتى نكمل إرسال طلبك</p>
              </motion.div>
            ) : (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={handleCheckout}
                className="w-full h-12 bg-[#25D366] text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#1da851] transition-all shadow-lg"
              >
                <MessageCircle className="w-5 h-5" />
                إكمال الطلب عبر واتساب
              </motion.button>
            )}
          </AnimatePresence>
          {insideSyria && !isCheckingOut && (
            <p className="text-xs text-slate-500 mt-2 text-center">للدفع عند الاستلام</p>
          )}
        </div>
      )}

      {paymentMethod === 'wallet' && (
        <div className="max-w-6xl mx-auto px-4 pb-8 mt-4">
          {(insideSyria 
            ? (!recipientName || !recipientPhone || !recipientAddress)
            : (!senderName || !senderPhone || !recipientName || !recipientPhone || !recipientAddress)
          ) ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm mb-4" dir="rtl">
              {insideSyria 
                ? 'يرجى إكمال بيانات المستقبل أعلاه (الاسم، الرقم، العنوان) قبل الدفع عبر المحفظة.'
                : 'يرجى إكمال بيانات التوصيل أعلاه (اسم المرسل، رقم الواتساب، اسم المستلم، العنوان) قبل الدفع عبر المحفظة.'
              }
            </div>
          ) : (
            <AnimatePresence>
              {isCheckingOut ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex flex-col items-center justify-center gap-4 py-8 bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl border border-slate-300 mb-4"
                >
                  <SmartLottie
                    animationPath={ANIMATION_PRESETS.paymentProcessing.path}
                    width={100}
                    height={100}
                    trigger="immediate"
                    loop={true}
                  />
                  <p className="text-slate-900 font-bold text-lg">معالجة الدفع...</p>
                  <p className="text-slate-600 text-sm">يرجى الانتظار حتى يتم خصم المبلغ من محفظتك</p>
                </motion.div>
              ) : (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={handleCheckout}
                  className="w-full h-12 bg-black text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-800 transition-all shadow-md"
                >
                  <Wallet className="w-5 h-5" />
                  دفع بواسطة المحفظة
                </motion.button>
              )}
            </AnimatePresence>
          )}
        </div>
      )}

      {/* Shared Cart Checkout Button */}
      {paymentMethod === 'shared_cart' && (
        <div className="max-w-6xl mx-auto px-4 pb-8 mt-4">
          {(!recipientName || !recipientPhone || !recipientAddress) ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm mb-4" dir="rtl">
              يرجى إكمال بيانات المستقبل أعلاه (الاسم، الرقم، العنوان) قبل مشاركة السلة.
            </div>
          ) : (
            <AnimatePresence>
              {isCheckingOut ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex flex-col items-center justify-center gap-4 py-8 bg-gradient-to-br from-purple-50 to-violet-50 rounded-2xl border border-purple-200 mb-4"
                >
                  <SmartLottie
                    animationPath={ANIMATION_PRESETS.paymentProcessing.path}
                    width={100}
                    height={100}
                    trigger="immediate"
                    loop={true}
                  />
                  <p className="text-purple-900 font-bold text-lg">جاري إنشاء السلة المشتركة...</p>
                  <p className="text-purple-600 text-sm">يرجى الانتظار حتى يتم إنشاء رابط المشاركة</p>
                </motion.div>
              ) : (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={handleCheckout}
                  className="w-full h-12 bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:from-[#7C3AED] hover:to-[#6D28D9] transition-all shadow-lg"
                >
                  <Share2 className="w-5 h-5" />
                  مشاركة السلة وإرسال الطلب
                </motion.button>
              )}
            </AnimatePresence>
          )}
          <p className="text-xs text-slate-500 mt-2 text-center" dir="rtl">
            سيتم إنشاء رابط مشاركة وإرسال الطلب للمشرف
          </p>
        </div>
      )}

      {/* Product Detail Modal */}
      <ProductDetailModal
        item={selectedItem}
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        onAddToCart={handleAddUpsellItem}
        exchangeRate={exchangeRate}
      />

      {/* Payment Success Animation Overlay */}
      <AnimatePresence>
        {showPaymentSuccessAnimation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="bg-white rounded-3xl p-8 flex flex-col items-center gap-4 max-w-sm mx-4 shadow-2xl"
            >
              <SmartLottie
                animationPath={ANIMATION_PRESETS.paymentSuccess.path}
                width={150}
                height={150}
                trigger="never"
                autoplay={true}
                loop={false}
                hideWhenDone={false}
              />
              <h2 className="text-2xl font-bold text-gray-900 text-center" dir="rtl">تمت معالجة الدفع</h2>
              <p className="text-gray-600 text-center text-sm" dir="rtl">{paymentSuccessMessage}</p>
              <div className="flex items-center gap-2 text-green-600 mt-2">
                <CheckCircle className="w-5 h-5" />
                <span className="font-semibold">سيتم نقلك إلى الطلبات...</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AppFooter />
    </div>
  );
};

export default Cart;


