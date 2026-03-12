import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchOrders, updateOrder } from '@/api/waselClient';

import { Package, Upload, CheckCircle, Clock, Truck, Phone, MapPin, Calendar, MessageSquare, Navigation, MessageCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import OrderChat from '../components/chat/OrderChat';
import PasswordProtection from '../components/common/PasswordProtection';
import SmartLottie from '@/components/animations/SmartLottie';
import { ANIMATION_PRESETS } from '@/components/animations/animationPresets';

const statusOptions = [
  { value: 'received', label: 'تم الاستلام', color: 'bg-blue-100 text-blue-700', icon: Clock },
  { value: 'processing', label: 'قيد التنفيذ', color: 'bg-yellow-100 text-yellow-700', icon: Truck },
  { value: 'delivered', label: 'تم التوصيل', color: 'bg-green-100 text-green-700', icon: CheckCircle }
];

export default function ExecutionTeam() {
  const [uploadingPhoto, setUploadingPhoto] = useState(null);
  const [chatOrderId, setChatOrderId] = useState(null);
  const [chatOrderNumber, setChatOrderNumber] = useState('');
  const queryClient = useQueryClient();

  const { data: allOrders, isLoading } = useQuery({
    queryKey: ['execution-orders'],
    queryFn: () => base44.entities.Order.list('-created_date', 100),
    initialData: []
  });

  // فقط الطلبات المدفوعة تظهر لفريق التنفيذ
  const orders = allOrders.filter(o => o.payment_status === 'paid');

  const updateOrderMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Order.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['execution-orders'] });
    }
  });

  const handlePhotoUpload = async (orderId, file) => {
    setUploadingPhoto(orderId);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      await updateOrderMutation.mutateAsync({
        id: orderId,
        data: { delivery_photo: file_url }
      });
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingPhoto(null);
    }
  };

  const handleStatusUpdate = async (orderId, status) => {
    const order = orders.find(o => o.id === orderId);
    
    updateOrderMutation.mutate({ id: orderId, data: { status } });

    // إرسال إشعار للعميل بتحديث الحالة
    if (order) {
      try {
        const statusText = status === 'received' ? 'تم استلام الطلب' :
                          status === 'processing' ? 'جاري التنفيذ والتوصيل' :
                          'تم التوصيل بنجاح';

        await base44.functions.invoke('sendNotification', {
          type: 'order_updated',
          orderNumber: order.order_number,
          recipientEmail: order.created_by,
          recipientName: order.sender_name,
          message: `تم تحديث حالة طلبك إلى: ${statusText}`,
          additionalData: {
            status: statusText,
            trackUrl: `${window.location.origin}/TrackOrder?order=${order.order_number}`
          }
        });
      } catch (err) {
        console.error('Failed to send notification:', err);
      }
    }
  };

  const handleDeliveryNoteUpdate = (orderId, note) => {
    updateOrderMutation.mutate({ id: orderId, data: { delivery_note: note } });
  };

  const updateDriverLocation = (orderId) => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            timestamp: new Date().toISOString()
          };

          const order = orders.find(o => o.id === orderId);
          const statusUpdates = order?.status_updates || [];
          const newUpdate = {
            status: order?.status || 'processing',
            timestamp: new Date().toISOString(),
            note: 'تحديث الموقع',
            location: {
              latitude: location.latitude,
              longitude: location.longitude
            }
          };

          updateOrderMutation.mutate({
            id: orderId,
            data: {
              driver_location: location,
              status_updates: [...statusUpdates, newUpdate]
            }
          });
        },
        (error) => {
          console.error('خطأ في الحصول على الموقع:', error);
          alert('لا يمكن الحصول على موقعك. تأكد من السماح بالوصول للموقع.');
        }
      );
    } else {
      alert('المتصفح لا يدعم خاصية الموقع الجغرافي');
    }
  };

  const activeOrders = orders.filter(o => o.status !== 'delivered');
  const completedOrders = orders.filter(o => o.status === 'delivered');

  return (
    <PasswordProtection>
    <div className="min-h-screen bg-[#FDFBF7]">
      {/* Header */}
      <section className="bg-gradient-to-br from-[#52B788] to-[#40916C] py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-14 h-14 bg-white/10 rounded-xl flex items-center justify-center">
              <Truck className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">فريق التنفيذ</h1>
              <p className="text-white/70">إدارة وتنفيذ الطلبات</p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white/10 rounded-xl p-4 text-center backdrop-blur-sm">
              <div className="text-3xl font-bold text-white">{activeOrders.length}</div>
              <div className="text-white/70 text-sm mt-1">طلبات نشطة</div>
            </div>
            <div className="bg-white/10 rounded-xl p-4 text-center backdrop-blur-sm">
              <div className="text-3xl font-bold text-white">
                {orders.filter(o => o.status === 'processing').length}
              </div>
              <div className="text-white/70 text-sm mt-1">قيد التنفيذ</div>
            </div>
            <div className="bg-white/10 rounded-xl p-4 text-center backdrop-blur-sm">
              <div className="text-3xl font-bold text-white">{completedOrders.length}</div>
              <div className="text-white/70 text-sm mt-1">مكتمل</div>
            </div>
          </div>
        </div>
      </section>

      {/* Orders List */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {isLoading ? (
          <div className="text-center py-12">
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
            <p className="text-[#1B4332]/60">جاري التحميل...</p>
          </div>
        ) : (
          <>
            {/* Active Orders */}
            {activeOrders.length > 0 && (
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-[#1B4332] mb-4 flex items-center gap-2">
                  <Clock className="w-6 h-6 text-[#52B788]" />
                  الطلبات النشطة ({activeOrders.length})
                </h2>
                <div className="space-y-4">
                  {activeOrders.map((order, index) => {
                    const [editingOrderId, setEditingOrderId] = React.useState(null);
                    const [tempData, setTempData] = React.useState(order);
                    const [tempPhoto, setTempPhoto] = React.useState(null);
                    const statusData = statusOptions.find(s => s.value === order.status) || statusOptions[0];
                    const StatusIcon = statusData.icon;
                    
                    return (
                      <motion.div
                        key={order.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="bg-white rounded-2xl p-6 shadow-lg border-2 border-[#52B788]/20"
                      >
                        {/* Header */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-[#F5E6D3]">
                          <div className="flex-1">
                            <h3 className="text-xl font-bold text-[#1B4332] mb-2">{order.order_number}</h3>
                            <div className="flex items-center gap-2 text-sm text-[#1B4332]/60">
                              <Calendar className="w-4 h-4" />
                              {new Date(order.created_date).toLocaleDateString('ar-SA', { 
                                month: 'short', 
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setChatOrderId(order.id);
                                setChatOrderNumber(order.order_number);
                              }}
                              className="bg-[#52B788]/10 border-[#52B788] text-[#52B788] hover:bg-[#52B788]/20"
                            >
                              <MessageCircle className="w-4 h-4 ml-1" />
                              محادثة
                            </Button>
                            <Badge className={`${statusData.color} text-base py-2 px-4`}>
                              <StatusIcon className="w-4 h-4 ml-2" />
                              {statusData.label}
                            </Badge>
                          </div>
                        </div>

                        {/* Order Details */}
                        <div className="grid md:grid-cols-2 gap-6 mb-6">
                          {/* Recipient Info */}
                          <div className="bg-[#F5E6D3]/50 rounded-xl p-4">
                            <h4 className="font-bold text-[#1B4332] mb-3 flex items-center gap-2">
                              <MapPin className="w-5 h-5 text-[#52B788]" />
                              معلومات التوصيل
                            </h4>
                            <div className="space-y-2 text-sm">
                              <div><span className="text-[#1B4332]/60">الاسم:</span> <strong className="text-[#1B4332] mr-2">{order.recipient_name}</strong></div>
                              <div><span className="text-[#1B4332]/60">المنطقة:</span> <strong className="text-[#1B4332] mr-2">{order.recipient_area}</strong></div>
                              <div className="flex items-center gap-2">
                                <span className="text-[#1B4332]/60">الهاتف:</span>
                                <strong className="text-[#1B4332] mr-2" dir="ltr">{order.recipient_phone}</strong>
                                <a
                                  href={`tel:${order.recipient_phone}`}
                                  className="bg-[#52B788] text-white p-1 rounded-lg"
                                >
                                  <Phone className="w-4 h-4" />
                                </a>
                              </div>
                            </div>
                          </div>

                          {/* Order Info */}
                          <div className="bg-blue-50 rounded-xl p-4">
                            <h4 className="font-bold text-[#1B4332] mb-3 flex items-center gap-2">
                              <Package className="w-5 h-5 text-[#52B788]" />
                              تفاصيل الطلب
                            </h4>
                            <div className="space-y-2 text-sm">
                              <div><span className="text-[#1B4332]/60">النوع:</span> <strong className="text-[#1B4332] mr-2">
                                {order.order_type === 'gift' ? 'هدية' : order.order_type === 'food' ? 'طعام' : 'باقة'}
                              </strong></div>
                              {order.package_type && (
                                <div className="bg-white rounded-lg p-2 mt-2">
                                  <span className="text-[#1B4332] font-medium">{order.package_type}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Product Details & Restaurant */}
                        {(order.notes || order.package_type) && (
                          <div className="bg-blue-50 rounded-xl p-4 mb-6">
                            <div className="space-y-3">
                              {order.package_type && (
                                <div>
                                  <p className="text-xs text-blue-600 font-semibold mb-1">📦 تفاصيل الطلب:</p>
                                  <p className="text-sm text-[#1B4332] font-medium">{order.package_type}</p>
                                </div>
                              )}
                              {order.notes && (
                                <div>
                                  <p className="text-xs text-blue-600 font-semibold mb-1">📝 وصف المنتجات والتفاصيل:</p>
                                  <p className="text-sm text-[#1B4332] whitespace-pre-line">{order.notes}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Editable Form */}
                        <div className="bg-[#F5E6D3]/30 rounded-xl p-4 space-y-4">
                          {/* Status Update */}
                          <div>
                            <Label className="text-sm font-semibold text-[#1B4332] mb-2 block">تحديث الحالة</Label>
                            <Select
                              value={tempData.status}
                              onValueChange={(value) => setTempData({...tempData, status: value})}
                            >
                              <SelectTrigger className="border-[#52B788] bg-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {statusOptions.map(opt => (
                                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Delivery Note */}
                          <div>
                            <Label className="text-sm font-semibold text-[#1B4332] mb-2 block">ملاحظة التوصيل</Label>
                            <Textarea
                              value={tempData.delivery_note || ''}
                              onChange={(e) => setTempData({...tempData, delivery_note: e.target.value})}
                              placeholder="اكتب ملاحظة عند التوصيل..."
                              className="border-[#52B788]/30 bg-white"
                            />
                          </div>

                          {/* Photo Upload */}
                          <div>
                            <Label className="text-sm font-semibold text-[#1B4332] mb-2 block">صورة التوثيق</Label>
                            {tempData.delivery_photo || tempPhoto ? (
                              <div className="relative">
                                <img 
                                  src={tempPhoto ? URL.createObjectURL(tempPhoto) : tempData.delivery_photo} 
                                  alt="توثيق" 
                                  className="w-full rounded-xl max-h-64 object-cover"
                                />
                                <Button
                                  size="sm"
                                  type="button"
                                  className="absolute top-2 right-2 bg-white/90 text-[#1B4332] hover:bg-white"
                                  onClick={() => {
                                    setTempData({...tempData, delivery_photo: null});
                                    setTempPhoto(null);
                                  }}
                                >
                                  تغيير الصورة
                                </Button>
                              </div>
                            ) : (
                              <>
                                <Label 
                                  htmlFor={`photo-${order.id}`} 
                                  className="cursor-pointer block"
                                >
                                  <div className="border-2 border-dashed border-[#52B788] rounded-xl p-6 text-center hover:bg-[#52B788]/5 transition-colors bg-white">
                                    <Upload className="w-6 h-6 text-[#52B788] mx-auto mb-2" />
                                    <p className="font-semibold text-[#52B788] text-sm">انقر لرفع صورة التوثيق</p>
                                  </div>
                                </Label>
                                <input
                                  id={`photo-${order.id}`}
                                  type="file"
                                  accept="image/*"
                                  capture="environment"
                                  className="hidden"
                                  onChange={(e) => {
                                    if (e.target.files?.[0]) {
                                      setTempPhoto(e.target.files[0]);
                                    }
                                  }}
                                />
                              </>
                            )}
                          </div>

                          {/* Location Update Button */}
                          <Button
                            type="button"
                            onClick={() => updateDriverLocation(order.id)}
                            className="w-full bg-blue-600 hover:bg-blue-700 gap-2"
                            variant="outline"
                          >
                            <Navigation className="w-4 h-4" />
                            تحديث الموقع الحالي
                          </Button>
                          {order.driver_location && (
                            <p className="text-xs text-[#52B788] text-center">
                              آخر تحديث: {new Date(order.driver_location.timestamp).toLocaleTimeString('ar-SA')}
                            </p>
                          )}

                          {/* Submit Button */}
                          <Button
                            onClick={async () => {
                              try {
                                let photoUrl = tempData.delivery_photo;
                                if (tempPhoto) {
                                  setUploadingPhoto(order.id);
                                  const { file_url } = await base44.integrations.Core.UploadFile({ file: tempPhoto });
                                  photoUrl = file_url;
                                  setUploadingPhoto(null);
                                }
                                
                                await updateOrderMutation.mutateAsync({
                                  id: order.id,
                                  data: {
                                    status: tempData.status,
                                    delivery_note: tempData.delivery_note,
                                    delivery_photo: photoUrl
                                  }
                                });

                                // Send notification
                                const statusText = tempData.status === 'received' ? 'تم استلام الطلب' :
                                                  tempData.status === 'processing' ? 'جاري التنفيذ والتوصيل' :
                                                  'تم التوصيل بنجاح';

                                await base44.functions.invoke('sendNotification', {
                                  type: 'order_updated',
                                  orderNumber: order.order_number,
                                  recipientEmail: order.created_by,
                                  recipientName: order.sender_name,
                                  message: `تم تحديث حالة طلبك إلى: ${statusText}`,
                                  additionalData: {
                                    status: statusText,
                                    trackUrl: `${window.location.origin}/TrackOrder?order=${order.order_number}`
                                  }
                                });
                              } catch (err) {
                                console.error(err);
                                alert('حدث خطأ أثناء الحفظ');
                              }
                            }}
                            className="w-full bg-gradient-to-r from-[#52B788] to-[#40916C] hover:from-[#40916C] hover:to-[#2D6A4F] text-white py-4 font-bold gap-2"
                            disabled={uploadingPhoto === order.id || updateOrderMutation.isPending}
                          >
                            {(uploadingPhoto === order.id || updateOrderMutation.isPending) ? (
                              <>
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                جاري الحفظ...
                              </>
                            ) : (
                              <>
                                <CheckCircle className="w-5 h-5" />
                                حفظ وإرسال التحديثات
                              </>
                            )}
                          </Button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Completed Orders */}
            {completedOrders.length > 0 && (
              <div>
                <h2 className="text-2xl font-bold text-[#1B4332] mb-4 flex items-center gap-2">
                  <CheckCircle className="w-6 h-6 text-[#52B788]" />
                  الطلبات المكتملة ({completedOrders.length})
                </h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  {completedOrders.slice(0, 6).map((order) => (
                    <div
                      key={order.id}
                      className="bg-white rounded-xl p-4 border border-[#F5E6D3] opacity-75"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-[#1B4332]">{order.order_number}</span>
                        <Badge className="bg-green-100 text-green-700">
                          <CheckCircle className="w-3 h-3 ml-1" />
                          تم التوصيل
                        </Badge>
                      </div>
                      <p className="text-sm text-[#1B4332]/60">
                        {order.recipient_name} - {order.recipient_area}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {orders.length === 0 && (
              <div className="text-center py-12 bg-white rounded-2xl">
                <Package className="w-16 h-16 text-[#1B4332]/20 mx-auto mb-4" />
                <p className="text-[#1B4332]/60">لا توجد طلبات حالياً</p>
              </div>
            )}
          </>
        )}
      </section>

      {/* Chat Dialog */}
      <Dialog open={!!chatOrderId} onOpenChange={() => setChatOrderId(null)}>
        <DialogContent className="max-w-2xl h-[600px] p-0" dir="rtl">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle>محادثة الطلب {chatOrderNumber}</DialogTitle>
          </DialogHeader>
          <div className="h-[calc(100%-80px)]">
            {chatOrderId && (
              <OrderChat
                orderId={chatOrderId}
                orderNumber={chatOrderNumber}
                senderType="team"
                senderName="فريق التنفيذ"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </PasswordProtection>
  );
}