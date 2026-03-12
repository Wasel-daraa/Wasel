import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

const isMobile = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// Fixed: Using Supabase functions with proper mobile support
// The 'create-paypal-payment' function now includes fallback for null origin headers from mobile
const API_BASE = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || 'https://ofdqkracfqakbtjjmksa.supabase.co/functions/v1';
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export default function PayPalPayment({ amount, onSuccess, onError }) {
    const paypalRef = useRef(null);
    const cardRef = useRef(null);
    const [sdkReady, setSdkReady] = useState(Boolean(window.paypal));
    const [showCardModal, setShowCardModal] = useState(false);
    const isMountedRef = useRef(true);

    // Track component mount/unmount to prevent "Detected container element removed from DOM" error
    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        // تحميل PayPal SDK
        if (window.paypal) {
            setSdkReady(true);
        } else {
            const script = document.createElement('script');
            const clientId = import.meta.env.VITE_PAYPAL_CLIENT_ID || 'AQyh8RxcB162UBup5qnzvCCoHfQQShlukM5VW4j-gpDGofEsP4iQkwEN9ZU-gTlLPHerV90Qm15tBPve';
            const merchantId = import.meta.env.VITE_PAYPAL_MERCHANT_ID || 'joudjr30@gmail.com';
            script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&merchant-id=${merchantId}&currency=USD&enable-funding=card&disable-funding=venmo`;
            script.async = true;
            script.onload = () => setSdkReady(true);
            script.onerror = () => {
                console.error('Failed to load PayPal SDK');
                toast.error('فشل تحميل PayPal');
            };
            document.body.appendChild(script);
        }
    }, [amount]);

    useEffect(() => {
        if (!sdkReady || !window.paypal || !paypalRef.current || !isMountedRef.current) return;

        // Check if container is still in the DOM
        if (!document.body.contains(paypalRef.current)) return;

        // مسح الزر القديم
        paypalRef.current.innerHTML = '';

        const createOrder = async () => {
            try {
                console.log('🔵 Creating PayPal order, amount:', amount);
                console.log('🔵 API URL:', `${API_BASE}/create-paypal-payment`);

                const response = await fetch(`${API_BASE}/create-paypal-payment`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${ANON_KEY}`,
                        'apikey': ANON_KEY
                    },
                    body: JSON.stringify({
                        action: 'create',
                        amount: String(amount),
                        currency: 'USD'
                    })
                });

                console.log('🔵 Response status:', response.status);
                const responseText = await response.text();
                console.log('🔵 Response body (raw):', responseText);

                if (!response.ok) {
                    console.error('❌ PayPal API Error:', responseText);
                    toast.error('فشل الاتصال بخادم الدفع');
                    throw new Error('Failed to create order');
                }

                const order = JSON.parse(responseText);
                console.log('✅ Order created:', order);

                if (order.id) {
                    console.log('✅ Order ID:', order.id);
                    return order.id;
                }

                console.error('❌ No order ID in response:', order);
                toast.error('لم يتم إنشاء رقم الطلب');
                throw new Error('No order ID');
            } catch (err) {
                console.error('❌ Create Order Error:', err);
                toast.error('حدث خطأ في إنشاء الطلب');
                throw err;
            }
        };

        const onApproveInternal = async (data) => {
            try {
                console.log('PayPal approved, capturing order:', data.orderID);

                const response = await fetch(`${API_BASE}/create-paypal-payment`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${ANON_KEY}`,
                        'apikey': ANON_KEY
                    },
                    body: JSON.stringify({
                        action: 'capture',
                        orderID: data.orderID
                    })
                });

                const details = await response.json();
                console.log('Capture result:', details);

                if (details.status === 'COMPLETED') {
                    toast.success('تم الدفع بنجاح! ✅');
                    onSuccess?.(details);
                    setShowCardModal(false);
                } else {
                    toast.error('لم يتم اكتمال الدفع');
                    onError?.(details);
                }
            } catch (err) {
                console.error('Capture Error:', err);
                toast.error('حدث خطأ في تأكيد الدفع');
                onError?.(err);
            }
        };

        const baseConfig = {
            createOrder,
            onApprove: onApproveInternal,
            onCancel: () => {
                console.log('PayPal payment cancelled');
                toast.info('تم إلغاء الدفع');
            },
            onError: (err) => {
                console.error('PayPal Error:', err);
                toast.error('حدث خطأ في PayPal');
                onError?.(err);
            },
        };

        const paypalButtons = window.paypal.Buttons({
            ...baseConfig,
            style: {
                layout: 'vertical',
                color: 'gold',
                shape: 'rect',
                label: 'paypal',
                height: 45
            },
            fundingSource: window.paypal.FUNDING.PAYPAL,
            ...(isMobile() ? { experience: { input_fields: { no_shipping: 1 } } } : {})
        });

        if (paypalButtons?.isEligible?.()) {
            paypalButtons.render(paypalRef.current);
        }
    }, [amount, onError, onSuccess, sdkReady]);

    useEffect(() => {
        if (!sdkReady || !window.paypal || !showCardModal || !cardRef.current || !isMountedRef.current) return;

        // Check if container is still in the DOM
        if (!document.body.contains(cardRef.current)) return;

        cardRef.current.innerHTML = '';

        const createOrder = async () => {
            try {
                console.log('🔵 Creating PayPal order, amount:', amount);
                console.log('🔵 API URL:', `${API_BASE}/create-paypal-payment`);

                const response = await fetch(`${API_BASE}/create-paypal-payment`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${ANON_KEY}`,
                        'apikey': ANON_KEY
                    },
                    body: JSON.stringify({
                        action: 'create',
                        amount: String(amount),
                        currency: 'USD'
                    })
                });

                console.log('🔵 Response status:', response.status);
                const responseText = await response.text();
                console.log('🔵 Response body (raw):', responseText);

                if (!response.ok) {
                    console.error('❌ PayPal API Error:', responseText);
                    toast.error('فشل الاتصال بخادم الدفع');
                    throw new Error('Failed to create order');
                }

                const order = JSON.parse(responseText);
                console.log('✅ Order created:', order);

                if (order.id) {
                    console.log('✅ Order ID:', order.id);
                    return order.id;
                }

                console.error('❌ No order ID in response:', order);
                toast.error('لم يتم إنشاء رقم الطلب');
                throw new Error('No order ID');
            } catch (err) {
                console.error('❌ Create Order Error:', err);
                toast.error('حدث خطأ في إنشاء الطلب');
                throw err;
            }
        };

        const onApproveInternal = async (data) => {
            try {
                console.log('PayPal approved, capturing order:', data.orderID);

                const response = await fetch(`${API_BASE}/create-paypal-payment`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${ANON_KEY}`,
                        'apikey': ANON_KEY
                    },
                    body: JSON.stringify({
                        action: 'capture',
                        orderID: data.orderID
                    })
                });

                const details = await response.json();
                console.log('Capture result:', details);

                if (details.status === 'COMPLETED') {
                    toast.success('تم الدفع بنجاح! ✅');
                    onSuccess?.(details);
                } else {
                    toast.error('لم يتم اكتمال الدفع');
                    onError?.(details);
                }
            } catch (err) {
                console.error('Capture Error:', err);
                toast.error('حدث خطأ في تأكيد الدفع');
                onError?.(err);
            }
        };

        const baseConfig = {
            createOrder,
            onApprove: onApproveInternal,
            onCancel: () => {
                console.log('PayPal payment cancelled');
                toast.info('تم إلغاء الدفع');
            },
            onError: (err) => {
                console.error('PayPal Error:', err);
                toast.error('حدث خطأ في PayPal');
                onError?.(err);
            },
        };

        const cardButtons = window.paypal.Buttons({
            ...baseConfig,
            style: {
                layout: 'vertical',
                color: 'black',
                shape: 'rect',
                label: 'pay',
                height: 45
            },
            fundingSource: window.paypal.FUNDING.CARD
        });

        if (cardButtons?.isEligible?.()) {
            cardButtons.render(cardRef.current);
        }
    }, [amount, onError, onSuccess, sdkReady, showCardModal]);

    useEffect(() => {
        if (!showCardModal) return undefined;

        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = originalOverflow;
        };
    }, [showCardModal]);

    return (
        <>
            <div className="w-full space-y-3 flex flex-col items-center">
                {/* زر PayPal */}
                <div ref={paypalRef} className="w-full max-w-[360px] min-h-[50px]"
                  style={isMobile() ? { minHeight: '55px', touchAction: 'manipulation' } : {}}
                ></div>

                {/* زر فتح الدفع بالبطاقة في نافذة مخصصة */}
                <button
                    type="button"
                    onClick={() => setShowCardModal(true)}
                    className="w-full max-w-[360px] h-[45px] rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] text-[#1F2937] font-bold hover:bg-[#EEF2F7] transition-colors"
                >
                    Debit or Credit Card
                </button>
            </div>

            {showCardModal && (
                <div className="fixed inset-0 z-[120] bg-black/55 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
                  onClick={(e) => { if (e.target === e.currentTarget) setShowCardModal(false); }}
                >
                    <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[#D1D5DB] bg-white p-4 shadow-2xl"
                      style={{ touchAction: 'manipulation' }}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-bold text-[#1F2937]" dir="rtl">الدفع بالبطاقة البنكية</h4>
                            <button
                                type="button"
                                onClick={() => setShowCardModal(false)}
                                className="w-8 h-8 rounded-full border border-[#D1D5DB] text-[#374151] hover:bg-[#F3F4F6]"
                            >
                                x
                            </button>
                        </div>
                        <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-3">
                            <div ref={cardRef} className="w-full min-h-[50px]"></div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
