// =====================================================
// WASEL - PRODUCT DETAIL PAGE (Full Secure Implementation)
// File: src/pages/ProductDetail.jsx
// =====================================================

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Heart, ShoppingCart, Minus, Plus, Share2, 
  ChevronLeft, Star, Clock, Check, AlertTriangle,
  Loader2, Truck, Shield, RefreshCw, ArrowRight,
  ChevronRight, X
} from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { secureApi, trackInteraction } from '@/services/secureApi';
import { ProductCard, ProductCardSkeleton } from '@/components/ProductCard';
import AddToCartButton from '@/components/buttons/AddToCartButton';
import { toast } from 'sonner';

// =====================================================
// CONSTANTS
// =====================================================
const EXCHANGE_RATE_USD_TO_LYR = 115;

// =====================================================
// IMAGE GALLERY COMPONENT
// =====================================================
function ImageGallery({ images, productName }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);

  const imageList = images?.length > 0 ? images : [null];

  return (
    <>
      {/* Main Image */}
      <div className="relative bg-[#F9FAF8] rounded-2xl overflow-hidden">
        <motion.div
          className="aspect-square cursor-zoom-in"
          onClick={() => setIsZoomed(true)}
          whileTap={{ scale: 0.98 }}
        >
          {imageList[activeIndex] ? (
            <img 
              src={imageList[activeIndex]} 
              alt={productName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ShoppingCart className="w-20 h-20 text-[#1F2933]/10" />
            </div>
          )}
        </motion.div>

        {/* Image Navigation */}
        {imageList.length > 1 && (
          <>
            <button
              onClick={() => setActiveIndex(prev => prev > 0 ? prev - 1 : imageList.length - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center shadow-lg"
            >
              <ChevronLeft className="w-5 h-5 text-[#1F2933]" />
            </button>
            <button
              onClick={() => setActiveIndex(prev => prev < imageList.length - 1 ? prev + 1 : 0)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center shadow-lg"
            >
              <ChevronRight className="w-5 h-5 text-[#1F2933]" />
            </button>

            {/* Dots */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
              {imageList.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveIndex(idx)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    idx === activeIndex 
                      ? 'w-6 bg-[#1F7A63]' 
                      : 'bg-white/60'
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {imageList.length > 1 && (
        <div className="flex gap-2 mt-3 overflow-x-auto pb-2">
          {imageList.map((img, idx) => (
            <button
              key={idx}
              onClick={() => setActiveIndex(idx)}
              className={`w-16 h-16 rounded-lg overflow-hidden shrink-0 border-2 transition-all ${
                idx === activeIndex 
                  ? 'border-[#1F7A63]' 
                  : 'border-transparent opacity-60'
              }`}
            >
              {img ? (
                <img src={img} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-[#F9FAF8]" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Zoom Modal */}
      <AnimatePresence>
        {isZoomed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
            onClick={() => setIsZoomed(false)}
          >
            <button className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
              <X className="w-6 h-6 text-white" />
            </button>
            <img 
              src={imageList[activeIndex]} 
              alt={productName}
              className="max-w-full max-h-full object-contain"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// =====================================================
// QUANTITY SELECTOR
// =====================================================
function QuantitySelector({ value, onChange, max, min = 1 }) {
  return (
    <div className="flex items-center gap-3 bg-[#F9FAF8] border border-[#E5E7EB] rounded-xl p-1">
      <motion.button
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="w-10 h-10 rounded-lg bg-white flex items-center justify-center disabled:opacity-50"
        whileTap={{ scale: 0.9 }}
      >
        <Minus className="w-4 h-4 text-[#1F2933]" />
      </motion.button>
      
      <span className="w-10 text-center font-bold text-[#1F2933]">{value}</span>
      
      <motion.button
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="w-10 h-10 rounded-lg bg-white flex items-center justify-center disabled:opacity-50"
        whileTap={{ scale: 0.9 }}
      >
        <Plus className="w-4 h-4 text-[#1F2933]" />
      </motion.button>
    </div>
  );
}

// =====================================================
// FEATURE BADGE
// =====================================================
function FeatureBadge({ icon: Icon, title, description }) {
  return (
    <div className="flex items-start gap-3 p-3 bg-[#F9FAF8] rounded-xl">
      <div className="w-10 h-10 rounded-lg bg-[#1F7A63]/10 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-[#1F7A63]" />
      </div>
      <div>
        <p className="font-medium text-[#1F2933] text-sm">{title}</p>
        <p className="text-xs text-[#1F2933]/50">{description}</p>
      </div>
    </div>
  );
}

// =====================================================
// REVIEWS SECTION
// =====================================================
function ReviewsSection({ productId, rating, reviewCount }) {
  const [reviews, setReviews] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadReviews = async () => {
      setIsLoading(true);
      try {
        const { data } = await supabase
          .from('reviews')
          .select('*, users:user_id(full_name, avatar_url)')
          .eq('product_id', productId)
          .order('created_at', { ascending: false })
          .limit(5);
        
        setReviews(data || []);
      } catch (err) {
        console.error('Failed to load reviews:', err);
      } finally {
        setIsLoading(false);
      }
    };

    if (productId) loadReviews();
  }, [productId]);

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-[#1F2933]" dir="rtl">التقييمات والمراجعات</h3>
        <div className="flex items-center gap-1">
          <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
          <span className="font-bold text-[#1F2933]">{rating?.toFixed(1) || '0.0'}</span>
          <span className="text-[#1F2933]/50 text-sm">({reviewCount || 0})</span>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="animate-pulse bg-[#F9FAF8] rounded-xl p-4">
              <div className="h-4 bg-[#E5E7EB] rounded w-1/4 mb-2" />
              <div className="h-3 bg-[#E5E7EB] rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <p className="text-[#1F2933]/50 text-sm text-center py-6" dir="rtl">
          لا توجد مراجعات بعد
        </p>
      ) : (
        <div className="space-y-3">
          {reviews.map(review => (
            <div key={review.id} className="bg-[#F9FAF8] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-[#1F7A63]/10 flex items-center justify-center">
                  {review.users?.avatar_url ? (
                    <img src={review.users.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-[#1F7A63]">
                      {review.users?.full_name?.charAt(0) || 'U'}
                    </span>
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-[#1F2933] text-sm">{review.users?.full_name || 'مستخدم'}</p>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map(star => (
                      <Star 
                        key={star} 
                        className={`w-3 h-3 ${star <= review.rating ? 'fill-amber-400 text-amber-400' : 'text-[#E5E7EB]'}`} 
                      />
                    ))}
                  </div>
                </div>
              </div>
              {review.comment && (
                <p className="text-sm text-[#1F2933]/70" dir="rtl">{review.comment}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =====================================================
// MAIN PRODUCT DETAIL PAGE
// =====================================================
export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [product, setProduct] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [error, setError] = useState(null);

  // Load product
  useEffect(() => {
    const loadProduct = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('id', id)
          .single();

        if (error) throw error;
        if (!data) throw new Error('المنتج غير موجود');

        setProduct(data);
        
        // Track view
        trackInteraction(id, 'view');

        // Check if favorite
        const session = await supabase.auth.getSession();
        if (session.data?.session) {
          const favStatus = await secureApi.checkFavorite(id);
          setIsFavorite(favStatus);
        }

        // Load related products
        if (data.category) {
          const { data: related } = await supabase
            .from('products')
            .select('*')
            .eq('category', data.category)
            .neq('id', id)
            .eq('is_active', true)
            .limit(4);
          
          setRelatedProducts(related || []);
        }
      } catch (err) {
        console.error('Failed to load product:', err);
        setError(err.message || 'فشل في تحميل المنتج');
      } finally {
        setIsLoading(false);
      }
    };

    if (id) loadProduct();
  }, [id]);

  // Toggle favorite
  const handleToggleFavorite = async () => {
    try {
      const session = await supabase.auth.getSession();
      if (!session.data?.session) {
        toast.error('يجب تسجيل الدخول لإضافة المفضلات');
        navigate('/login');
        return;
      }

      setIsFavorite(!isFavorite);
      await secureApi.toggleFavorite(id);
      trackInteraction(id, isFavorite ? 'unfavorite' : 'favorite');
      toast.success(isFavorite ? 'تمت الإزالة من المفضلة' : 'تمت الإضافة للمفضلة');
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
      setIsFavorite(!isFavorite); // Revert
      toast.error('فشل في تحديث المفضلة');
    }
  };

  // Add to cart
  const handleAddToCart = async () => {
    if (!product || product.stock_qty === 0) return;

    setIsAddingToCart(true);

    try {
      const session = await supabase.auth.getSession();
      
      if (session.data?.session) {
        await secureApi.addToCart(product.id, quantity, product.price_usd);
      }

      trackInteraction(product.id, 'add_to_cart');
      
      const currentCount = parseInt(localStorage.getItem('cart_count') || '0');
      localStorage.setItem('cart_count', String(currentCount + quantity));

      toast.success(`تمت إضافة ${quantity} إلى السلة!`);
    } catch (err) {
      console.error('Failed to add to cart:', err);
      toast.error('فشل في إضافة المنتج إلى السلة');
    } finally {
      setIsAddingToCart(false);
    }
  };

  // Share
  const handleShare = async () => {
    try {
      await navigator.share({
        title: product?.name_ar || product?.name,
        text: product?.description,
        url: window.location.href,
      });
    } catch (err) {
      // Fallback to clipboard
      await navigator.clipboard.writeText(window.location.href);
      toast.success('تم نسخ الرابط!');
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F9FAF8] pb-24">
        <div className="animate-pulse p-4">
          <div className="aspect-square bg-[#E5E7EB] rounded-2xl mb-4" />
          <div className="h-6 bg-[#E5E7EB] rounded w-3/4 mb-2" />
          <div className="h-4 bg-[#E5E7EB] rounded w-1/2 mb-4" />
          <div className="h-8 bg-[#E5E7EB] rounded w-1/3" />
        </div>
      </div>
    );
  }

  // Error state
  if (error || !product) {
    return (
      <div className="min-h-screen bg-[#F9FAF8] flex items-center justify-center p-4">
        <div className="text-center">
          <AlertTriangle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-[#1F2933] mb-2">عذراً!</h2>
          <p className="text-[#1F2933]/60 mb-6">{error || 'المنتج غير موجود'}</p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-[#1F7A63] text-white rounded-xl font-bold"
          >
            العودة للرئيسية
          </button>
        </div>
      </div>
    );
  }

  const priceLYR = Math.round(product.price_usd * EXCHANGE_RATE_USD_TO_LYR);
  const hasDiscount = product.original_price_usd && product.original_price_usd > product.price_usd;
  const discountPercent = hasDiscount 
    ? Math.round((1 - product.price_usd / product.original_price_usd) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-[#F9FAF8] pb-32">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#F9FAF8]/80 backdrop-blur-lg border-b border-[#E5E7EB]">
        <div className="flex items-center justify-between p-4">
          <button
            onClick={() => navigate(-1)}
            className="w-10 h-10 rounded-full bg-white border border-[#E5E7EB] flex items-center justify-center"
          >
            <ArrowRight className="w-5 h-5 text-[#1F2933]" />
          </button>

          <div className="flex items-center gap-2">
            <motion.button
              onClick={handleToggleFavorite}
              className={`w-10 h-10 rounded-full flex items-center justify-center ${
                isFavorite 
                  ? 'bg-red-50 text-red-500' 
                  : 'bg-white border border-[#E5E7EB] text-[#1F2933]'
              }`}
              whileTap={{ scale: 0.9 }}
            >
              <Heart className={`w-5 h-5 ${isFavorite ? 'fill-current' : ''}`} />
            </motion.button>

            <button
              onClick={handleShare}
              className="w-10 h-10 rounded-full bg-white border border-[#E5E7EB] flex items-center justify-center"
            >
              <Share2 className="w-5 h-5 text-[#1F2933]" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Image Gallery */}
        <ImageGallery 
          images={product.images || [product.image_url]} 
          productName={product.name_ar || product.name}
        />

        {/* Product Info */}
        <div className="mt-6">
          {/* Category */}
          {product.category && (
            <p className="text-sm text-[#1F7A63] font-medium mb-1" dir="rtl">
              {product.category}
            </p>
          )}

          {/* Title */}
          <h1 className="text-2xl font-bold text-[#1F2933] mb-2" dir="rtl">
            {product.name_ar || product.name}
          </h1>

          {/* Rating */}
          <div className="flex items-center gap-2 mb-4">
            <div className="flex items-center gap-1">
              <Star className="w-5 h-5 fill-amber-400 text-amber-400" />
              <span className="font-bold text-[#1F2933]">{product.avg_rating?.toFixed(1) || '0.0'}</span>
            </div>
            <span className="text-[#1F2933]/40">•</span>
            <span className="text-[#1F2933]/60 text-sm">{product.review_count || 0} تقييم</span>
          </div>

          {/* Price */}
          <div className="flex items-baseline gap-3 mb-4">
            <span className="text-3xl font-bold text-[#1F7A63]">
              ${product.price_usd?.toFixed(2)}
            </span>
            
            {hasDiscount && (
              <span className="text-lg text-[#1F2933]/40 line-through">
                ${product.original_price_usd?.toFixed(2)}
              </span>
            )}

            <span className="text-sm text-[#1F2933]/40">
              ≈ {priceLYR.toLocaleString()} LYR
            </span>

            {hasDiscount && (
              <span className="px-2 py-1 bg-red-100 text-red-600 text-xs font-bold rounded-full">
                -{discountPercent}%
              </span>
            )}
          </div>

          {/* Stock Status */}
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
            product.stock_qty === 0
              ? 'bg-red-50 text-red-600'
              : product.stock_qty < 10
                ? 'bg-amber-50 text-amber-600'
                : 'bg-green-50 text-[#2FA36B]'
          }`}>
            {product.stock_qty === 0 ? (
              <>
                <AlertTriangle className="w-4 h-4" />
                غير متوفر حالياً
              </>
            ) : product.stock_qty < 10 ? (
              <>
                <Clock className="w-4 h-4" />
                متبقي {product.stock_qty} فقط
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                متوفر في المخزون
              </>
            )}
          </div>

          {/* Description */}
          {product.description && (
            <div className="mt-6">
              <h3 className="font-bold text-[#1F2933] mb-2" dir="rtl">الوصف</h3>
              <p className="text-[#1F2933]/70 leading-relaxed" dir="rtl">
                {product.description}
              </p>
            </div>
          )}

          {/* Features */}
          <div className="mt-6 grid gap-3">
            <FeatureBadge 
              icon={Truck} 
              title="توصيل سريع" 
              description="خلال 30-60 دقيقة" 
            />
            <FeatureBadge 
              icon={Shield} 
              title="ضمان الجودة" 
              description="استرجاع أو استبدال مجاني" 
            />
            <FeatureBadge 
              icon={RefreshCw} 
              title="دفع آمن" 
              description="PayPal أو الدفع عند الاستلام" 
            />
          </div>

          {/* Reviews Section */}
          <ReviewsSection 
            productId={product.id}
            rating={product.avg_rating}
            reviewCount={product.review_count}
          />

          {/* Related Products */}
          {relatedProducts.length > 0 && (
            <div className="mt-8">
              <h3 className="font-bold text-[#1F2933] mb-4" dir="rtl">منتجات مشابهة</h3>
              <div className="grid grid-cols-2 gap-3">
                {relatedProducts.map(relProduct => (
                  <ProductCard
                    key={relProduct.id}
                    product={relProduct}
                    size="small"
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fixed Bottom Action */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#E5E7EB] p-4 z-40">
        <div className="flex items-center gap-4">
          {/* Quantity Selector */}
          <QuantitySelector
            value={quantity}
            onChange={setQuantity}
            max={product.stock_qty || 99}
          />

          {/* Add to Cart Button */}
          <AddToCartButton
            onClick={handleAddToCart}
            disabled={product.stock_qty === 0 || isAddingToCart}
            isLoading={isAddingToCart}
            label={`إضافة للسلة - $${(product.price_usd * quantity).toFixed(2)}`}
            className="flex-1 h-12"
          />
        </div>
      </div>
    </div>
  );
}
