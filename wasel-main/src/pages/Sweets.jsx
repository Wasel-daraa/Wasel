import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '../api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Search, Cake, Star, Clock, MapPin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/components/common/LanguageContext';
import { createPageUrl } from '@/utils';
import SmartLottie from '@/components/animations/SmartLottie';
import { ANIMATION_PRESETS } from '@/components/animations/animationPresets';
import { RestaurantCardSkeleton } from '@/components/common/SkeletonLoaders';

const Sweets = () => {
  const { language } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: restaurants = [], isLoading } = useQuery({
    queryKey: ['restaurants', 'sweets'],
    queryFn: async () => {
      try {
        const data = await base44.entities.Restaurant.list();
        const items = Array.isArray(data) ? data : [];
        return items.filter(r =>
          r.available !== false &&
          (r.cuisine_type === 'حلويات' || r.cuisine_type === 'sweets' ||
           r.category === 'sweets' || r.category === 'حلويات' ||
           (r.name || '').includes('حلو') || (r.name || '').includes('sweet'))
        );
      } catch {
        return [];
      }
    },
  });

  const filteredRestaurants = useMemo(() => {
    if (!searchQuery) return restaurants;
    const q = searchQuery.toLowerCase();
    return restaurants.filter(r =>
      (r.name || '').toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q)
    );
  }, [restaurants, searchQuery]);

  return (
    <div className="min-h-screen bg-gray-50 font-['Cairo']">
      {/* Header */}
      <header className="bg-gradient-to-br from-pink-500 to-rose-400 py-10 text-white">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <Cake className="w-12 h-12 mx-auto mb-3 opacity-80" />
          <h1 className="text-3xl font-bold mb-2">الحلويات</h1>
          <p className="text-base opacity-90">ألذ الحلويات والمعجنات الطازجة</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 -mt-6">
        {/* Search */}
        <div className="bg-white rounded-xl shadow-lg p-4 mb-6 sticky top-4 z-10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث في الحلويات..."
              className="pl-10"
              dir="rtl"
            />
          </div>
        </div>

        {/* Loading */}
        {isLoading ? (
          <div className="space-y-4">
            <div className="flex justify-center mb-4">
              <SmartLottie
                animationPath={ANIMATION_PRESETS.pageLoading.path}
                width={80}
                height={80}
                trigger="never"
                autoplay={true}
                loop={true}
              />
            </div>
            {[1, 2, 3].map(i => <RestaurantCardSkeleton key={i} />)}
          </div>
        ) : filteredRestaurants.length === 0 ? (
          <div className="text-center py-16">
            <Cake className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-bold text-gray-500">لا توجد حلويات حالياً</h3>
            <p className="text-gray-400 text-sm mt-1">يتم إضافة محلات جديدة قريباً</p>
          </div>
        ) : (
          <div className="grid gap-4">
            <AnimatePresence>
              {filteredRestaurants.map((restaurant, index) => (
                <motion.div
                  key={restaurant.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Link to={createPageUrl('RestaurantDetail') + `?id=${restaurant.id}`}>
                    <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                      {/* Image */}
                      <div className="relative h-48 bg-gray-200 overflow-hidden">
                        {restaurant.image ? (
                          <img
                            src={restaurant.image}
                            alt={restaurant.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-pink-50">
                            <Cake className="w-16 h-16 text-pink-200" />
                          </div>
                        )}
                        {restaurant.rating && (
                          <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-lg flex items-center gap-1">
                            <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                            <span className="text-sm font-bold">{restaurant.rating}</span>
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="p-4" dir="rtl">
                        <h3 className="font-bold text-lg text-gray-800 mb-1">{restaurant.name}</h3>
                        {restaurant.description && (
                          <p className="text-gray-500 text-sm line-clamp-2 mb-3">{restaurant.description}</p>
                        )}
                        <div className="flex items-center gap-4 text-xs text-gray-400">
                          {restaurant.delivery_time && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              {restaurant.delivery_time} دقيقة
                            </span>
                          )}
                          {restaurant.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3.5 h-3.5" />
                              {restaurant.location}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  );
};

export default Sweets;
