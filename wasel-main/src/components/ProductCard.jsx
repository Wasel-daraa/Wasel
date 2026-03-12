// =====================================================
// WASEL - PRODUCT CARD COMPONENT (Enhanced UI)
// File: src/components/ProductCard.jsx
// =====================================================

import React, { useState, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, Plus, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUsdToSypRate } from '@/lib/exchangeRate';
import SmartLottie from '@/components/animations/SmartLottie';
import { ANIMATION_PRESETS } from '@/components/animations/animationPresets';
import AddToCartButton from '@/components/buttons/AddToCartButton';

// =====================================================
// CONSTANTS - نفس الثوابت في Cart.jsx
// =====================================================
const EXCHANGE_RATE = 150; // fallback
const MARKUP_FACTOR = 1.20; // 20% زيادة وهمية
const FAKE_DOUBLE_FACTOR = 2.0; // السعر المضاعف المشطوب

// =====================================================
// PRODUCT CARD COMPONENT
// =====================================================
const ProductCard = memo(function ProductCard({ 
  product, 
  isFavorited = false,
  onFavoriteChange,
  onCartAdd,
  showQuickView = true,
  size = 'normal' // 'normal' | 'small' | 'large'
}) {
  const navigate = useNavigate();
  const [isHovered, setIsHovered] = useState(false);
  const [isFav, setIsFav] = useState(isFavorited);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [favLoading, setFavLoading] = useState(false);
  const [showAddAnimation, setShowAddAnimation] = useState(false);
  const exchangeRate = useUsdToSypRate() || EXCHANGE_RATE;

  // السعر الأصلي من Base44 (بالليرة السورية)
  const originalPriceSYP = product.customer_price || product.price || (product.price_cents ? product.price_cents / 100 * exchangeRate : 0);
  
  // السعر الظاهر (الذي يدفعه العميل) = السعر الأصلي × 1.20
  const displayedPriceSYP = Math.round(originalPriceSYP * MARKUP_FACTOR);
  const displayedPriceUSD = displayedPriceSYP / exchangeRate;
  
  // السعر المضاعف (للعرض مشطوب) = السعر المعروض × 2 (ليكون الخصم 50% صحيح)
  const doublePriceSYP = displayedPriceSYP * 2;
  const doublePriceUSD = doublePriceSYP / exchangeRate;
  
  // خصم 50% دائماً
  const discountPercent = 50;

  // Image URL
  const imageUrl = product.images?.[0] || product.thumbnail_url || product.image || '/placeholder-product.png';
  const productTitle = product.title_ar || product.title || product.name || 'منتج';
  const productStock = product.stock ?? 10;

  // Size configurations
  const sizeConfig = {
    small: {
      card: 'w-36',
      image: 'h-28',
      title: 'text-xs line-clamp-1',
      price: 'text-sm',
      heart: 'w-5 h-5',
      heartBtn: 'w-7 h-7',
      addBtn: 'text-xs px-2 py-1'
    },
    normal: {
      card: 'w-full',
      image: 'h-32',
      title: 'text-sm line-clamp-2',
      price: 'text-base',
      heart: 'w-5 h-5',
      heartBtn: 'w-8 h-8',
      addBtn: 'text-sm px-3 py-1.5'
    },
    large: {
      card: 'w-full',
      image: 'h-48',
      title: 'text-base line-clamp-2',
      price: 'text-lg',
      heart: 'w-6 h-6',
      heartBtn: 'w-10 h-10',
      addBtn: 'text-base px-4 py-2'
    }
  };

  const config = sizeConfig[size];

  // Handle favorite toggle
  const handleFavorite = useCallback(async (e) => {
    e.stopPropagation();
    if (favLoading) return;

    setFavLoading(true);
    // Optimistic update
    const newState = !isFav;
    setIsFav(newState);

    try {
      onFavoriteChange?.(product.id, newState);
    } catch (error) {
      // Revert on error
      setIsFav(!newState);
      console.error('Failed to toggle favorite:', error);
    } finally {
      setFavLoading(false);
    }
  }, [product.id, isFav, favLoading, onFavoriteChange]);

  // Handle add to cart
  const handleAddToCart = useCallback(async (e) => {
    e.stopPropagation();
    if (isAddingToCart || productStock < 1) return;

    setIsAddingToCart(true);
    setShowAddAnimation(true);
    try {
      onCartAdd?.(product);
    } catch (error) {
      console.error('Failed to add to cart:', error);
    } finally {
      setTimeout(() => setIsAddingToCart(false), 500);
      setTimeout(() => setShowAddAnimation(false), 1500);
    }
  }, [product, isAddingToCart, productStock, onCartAdd]);

  // Handle card click
  const handleCardClick = useCallback(() => {
    navigate(`/product/${product.id}`);
  }, [product.id, navigate]);

  return (
    <motion.div
      className={`${config.card} bg-white rounded-2xl overflow-hidden shadow-sm border border-[#E5E7EB] cursor-pointer relative group`}
      whileHover={{ y: -4, boxShadow: '0 12px 24px rgba(31, 122, 99, 0.12)' }}
      whileTap={{ scale: 0.98 }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      onClick={handleCardClick}
      layout
    >
      {/* Image Container */}
      <div className={`relative ${config.image} overflow-hidden bg-[#F9FAF8]`}>
        {/* Product Image */}
        <img
          src={imageUrl}
          alt={productTitle}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
          loading="lazy"
          onError={(e) => { e.target.src = '/placeholder-product.png'; }}
        />

        {/* Discount Badge - خصم 50% دائماً */}
        <div className="absolute top-2 left-2 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md">
          خصم {discountPercent}%
        </div>

        {/* Out of Stock Overlay */}
        {productStock < 1 && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="text-white font-bold text-sm bg-red-500 px-3 py-1 rounded-full">
              نفذ المخزون
            </span>
          </div>
        )}

        {/* Favorite Button */}
        <motion.button
          className={`absolute top-2 right-2 ${config.heartBtn} rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-md z-10`}
          onClick={handleFavorite}
          whileTap={{ scale: 0.85 }}
          disabled={favLoading}
        >
          <Heart
            className={`${config.heart} transition-colors duration-200 ${
              isFav 
                ? 'fill-red-500 text-red-500' 
                : 'text-[#1F2933]/50 group-hover:text-red-400'
            }`}
          />
        </motion.button>

        {/* Quick Add Button (on hover) */}
        <AnimatePresence>
          {showQuickView && isHovered && productStock > 0 && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className={`absolute bottom-2 left-1/2 -translate-x-1/2 bg-[#1F7A63] hover:bg-[#2FA36B] text-white ${config.addBtn} rounded-full flex items-center gap-1 font-medium shadow-lg transition-colors`}
              onClick={handleAddToCart}
              disabled={isAddingToCart}
            >
              {isAddingToCart ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>إضافة</span>
                </>
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Category */}
        {product.category && (
          <span className="text-[10px] text-[#1F7A63] font-medium bg-[#1F7A63]/10 px-2 py-0.5 rounded-full">
            {product.category}
          </span>
        )}

        {/* Title */}
        <h3 className={`font-semibold text-[#1F2933] ${config.title}`} dir="rtl">
          {productTitle}
        </h3>

        {/* Rating */}
        {product.rating_count > 0 && (
          <div className="flex items-center gap-1">
            <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
            <span className="text-xs text-[#1F2933]/70">
              {product.rating_avg?.toFixed(1)} ({product.rating_count})
            </span>
          </div>
        )}

        {/* Price - السعر المضاعف مشطوب + السعر الظاهر */}
        <div className="flex items-end justify-between gap-2">
          <div className="flex flex-col">
            {/* السعر المضاعف مشطوب */}
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400 line-through">
                {doublePriceSYP.toLocaleString('en-US')} ل.س
              </span>
              <span className="text-[10px] text-gray-300 line-through">
                ${doublePriceUSD.toFixed(2)}
              </span>
            </div>
            {/* السعر الظاهر */}
            <div className="flex items-center gap-1">
              <span className={`font-bold text-[#C2185B] ${config.price}`}>
                {displayedPriceSYP.toLocaleString('en-US')} ل.س
              </span>
              <span className="text-xs text-gray-500">
                | ${displayedPriceUSD.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <div className="relative">
          <AddToCartButton
            onClick={(e) => { if (e) e.stopPropagation(); handleAddToCart({ stopPropagation: () => {} }); }}
            disabled={isAddingToCart || productStock < 1}
            isLoading={isAddingToCart}
            label="أضف إلى السلة"
            className="mt-2 h-9 text-xs"
          />

          {/* Add to Cart Animation */}
          <AnimatePresence>
            {showAddAnimation && (
              <div className="absolute -top-20 left-1/2 transform -translate-x-1/2 z-50">
                <SmartLottie
                  animationPath={ANIMATION_PRESETS.addToCartSuccess.path}
                  width={100}
                  height={100}
                  trigger="never"
                  autoplay={true}
                  loop={false}
                  hideWhenDone={true}
                />
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Stock Warning */}
        {productStock > 0 && productStock <= 5 && (
          <div className="text-[10px] text-orange-600 font-medium">
            ⚠️ باقي {productStock} فقط
          </div>
        )}
      </div>
    </motion.div>
  );
});

// =====================================================
// PRODUCT GRID COMPONENT
// =====================================================
export function ProductGrid({ 
  products, 
  favorites = [],
  onFavoriteChange,
  onCartAdd,
  columns = 2,
  gap = 4,
  loading = false 
}) {
  const gridClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-2 md:grid-cols-3',
    4: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
  };

  const gapClass = {
    2: 'gap-2',
    3: 'gap-3',
    4: 'gap-4',
    6: 'gap-6'
  };

  if (loading) {
    return (
      <div className={`grid ${gridClass[columns]} ${gapClass[gap]}`}>
        {[...Array(6)].map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!products || products.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-6xl mb-4">🔍</div>
        <h3 className="text-lg font-semibold text-[#1F2933]">لا توجد منتجات</h3>
        <p className="text-[#1F2933]/60 text-sm mt-1">جرب البحث بكلمات مختلفة</p>
      </div>
    );
  }

  const favoriteIds = new Set(favorites.map(f => f.product_id || f.id));

  return (
    <div className={`grid ${gridClass[columns]} ${gapClass[gap]}`}>
      <AnimatePresence mode="popLayout">
        {products.map((product, index) => (
          <motion.div
            key={product.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ delay: index * 0.05 }}
          >
            <ProductCard
              product={product}
              isFavorited={favoriteIds.has(product.id)}
              onFavoriteChange={onFavoriteChange}
              onCartAdd={onCartAdd}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// =====================================================
// SKELETON LOADER
// =====================================================
function ProductCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-[#E5E7EB] animate-pulse">
      <div className="h-32 bg-[#E5E7EB]" />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-[#E5E7EB] rounded w-16" />
        <div className="h-4 bg-[#E5E7EB] rounded w-full" />
        <div className="h-4 bg-[#E5E7EB] rounded w-3/4" />
        <div className="flex justify-between items-center">
          <div className="h-5 bg-[#E5E7EB] rounded w-20" />
          <div className="h-8 w-8 bg-[#E5E7EB] rounded-full" />
        </div>
      </div>
    </div>
  );
}

export default ProductCard;