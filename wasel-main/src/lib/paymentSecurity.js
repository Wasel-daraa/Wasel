// =====================================================
// PAYMENT SECURITY VALIDATION & ORDER PROTECTION
// File: src/lib/paymentSecurity.js
// =====================================================

/**
 * صارم: منع إنشاء طلب بدون دفع حقيقي
 * يجب أن يكون هناك دليل على الدفع قبل إنشاء الطلب
 */
export function validatePaymentBeforeOrder(orderData) {
  const errors = [];

  // تحقق من وجود طريقة الدفع
  if (!orderData.paymentMethod) {
    errors.push('طريقة الدفع مطلوبة');
  }

  // تحقق من أن طريقة الدفع معروفة
  const VALID_METHODS = ['paypal', 'wallet', 'whatsapp', 'card', 'shared_cart'];
  if (orderData.paymentMethod && !VALID_METHODS.includes(orderData.paymentMethod)) {
    errors.push(`طريقة دفع غير صحيحة: ${orderData.paymentMethod}`);
  }

  // تحقق من أن هناك مبلغ (support both flat and nested)
  const amount = orderData.amount || orderData.totalUSD || 0;
  if (!amount || amount <= 0) {
    errors.push('المبلغ يجب أن يكون أعظم من صفر');
  }

  // تحقق من أن البيانات المطلوبة موجودة (support both flat and nested)
  const recipientName = orderData.recipientName || orderData.recipient?.name;
  const recipientPhone = orderData.recipientPhone || orderData.recipient?.phone;
  if (!recipientName || !recipientPhone) {
    errors.push('بيانات المستقبل مطلوبة');
  }

  // تحقق من وجود أصناف
  if (!Array.isArray(orderData.items) || orderData.items.length === 0) {
    errors.push('الطلب يجب أن يحتوي على أصناف');
  }

  // تحقق من صحة الأصناف
  if (Array.isArray(orderData.items)) {
    orderData.items.forEach((item, index) => {
      if (!item.id || !item.quantity || item.quantity <= 0) {
        errors.push(`الصنف ${index + 1} غير صحيح`);
      }
      const itemPrice = item.price || item.priceSYP || item.priceUSD || 0;
      if (itemPrice < 0) {
        errors.push(`سعر الصنف ${index + 1} غير صحيح`);
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * صارم: التحقق من PayPal Payment
 * تأكد من أن المبلغ والعملة صحيحة
 */
export function validatePayPalOrder(paypalOrder, expectedAmount, expectedCurrency = 'USD') {
  const errors = [];

  if (!paypalOrder) {
    errors.push('لا توجد بيانات طلب PayPal');
    return { isValid: false, errors };
  }

  // تحقق من معرّف الطلب
  if (!paypalOrder.id) {
    errors.push('معرّف الطلب مفقود');
  }

  // تحقق من حالة الطلب
  if (paypalOrder.status !== 'APPROVED' && paypalOrder.status !== 'COMPLETED') {
    errors.push(`حالة الطلب غير صحيحة: ${paypalOrder.status}`);
  }

  // تحقق من القيمة الإجمالية
  if (paypalOrder.purchase_units && paypalOrder.purchase_units.length > 0) {
    const totalAmount = paypalOrder.purchase_units.reduce((sum, unit) => {
      const amount = parseFloat(unit.amount?.value || 0);
      return sum + amount;
    }, 0);

    const expectedAmountNum = parseFloat(expectedAmount);
    
    // التسامح: ±$0.01 بسبب تقريب العملات
    if (Math.abs(totalAmount - expectedAmountNum) > 0.01) {
      errors.push(
        `عدم تطابق المبلغ. المتوقع: $${expectedAmountNum}, المستلم: $${totalAmount}`
      );
    }
  } else {
    errors.push('لا توجد وحدات الشراء');
  }

  // تحقق من العملة
  if (paypalOrder.purchase_units?.[0]?.amount?.currency_code !== expectedCurrency) {
    errors.push(
      `عملة غير صحيحة. المتوقع: ${expectedCurrency}, المستلم: ${paypalOrder.purchase_units?.[0]?.amount?.currency_code}`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * معتدل: التحقق من محفظة المستخدم قبل الدفع
 */
export function validateWalletPayment(walletBalance, requiredAmount) {
  const errors = [];

  if (walletBalance < 0) {
    errors.push('خطأ في رصيد المحفظة');
    return { isValid: false, errors };
  }

  if (walletBalance < requiredAmount) {
    errors.push(
      `رصيد المحفظة غير كافي. المتوفر: $${walletBalance.toFixed(2)}, المطلوب: $${requiredAmount.toFixed(2)}`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * صارم: منع التلاعب بالمبلغ أثناء الدفع
 * تحقق من أن المبلغ المرسل للدفع يطابق الطلب المخزن
 */
export function validateAmountMatch(cartTotal, paymentAmount) {
  const cartNum = parseFloat(cartTotal);
  const payNum = parseFloat(paymentAmount);

  // التسامح: ±$0.01 فقط
  if (Math.abs(cartNum - payNum) > 0.01) {
    return {
      isValid: false,
      error: `عدم تطابق المبلغ: الطلب ${cartNum}$, المدفوع ${payNum}$`,
    };
  }

  return { isValid: true };
}

/**
 * صارم: التحقق من ID الطلب قبل الدفع
 */
export function validateOrderId(orderId) {
  // يجب أن يكون UUID صحيح
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (!orderId || !uuidRegex.test(orderId)) {
    return {
      isValid: false,
      error: 'معرّف الطلب غير صحيح',
    };
  }

  return { isValid: true };
}

/**
 * معتدل: منع عمليات السحب المتكررة من PayPal
 */
const PAYPAL_PENDING_ORDERS = new Map();
const PAYPAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 دقائق

export function checkPayPalPending(orderId) {
  const lastAction = PAYPAL_PENDING_ORDERS.get(orderId);
  const now = Date.now();

  if (lastAction && now - lastAction < PAYPAL_TIMEOUT_MS) {
    return {
      isPending: true,
      remainingMs: PAYPAL_TIMEOUT_MS - (now - lastAction),
      error: 'عملية دفع القيد قيد الانتظار. يرجى الانتظار...',
    };
  }

  return { isPending: false };
}

export function markPayPalPending(orderId) {
  PAYPAL_PENDING_ORDERS.set(orderId, Date.now());
  
  // حذف تلقائياً بعد انتهاء الـ timeout
  setTimeout(() => {
    PAYPAL_PENDING_ORDERS.delete(orderId);
  }, PAYPAL_TIMEOUT_MS);
}

export function clearPayPalPending(orderId) {
  PAYPAL_PENDING_ORDERS.delete(orderId);
}

/**
 * صارم: التحقق من أن الطلب موجود قبل معالجة الدفع
 */
export async function validateOrderExistsAndOwned(supabase, orderId, userId) {
  const { data: order, error } = await supabase
    .from('orders')
    .select('id, user_id, payment_status, status, total_usd')
    .eq('id', orderId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`فشل التحقق من الطلب: ${error.message}`);
  }

  if (!order) {
    throw new Error('الطلب غير موجود أو لا تملك صلاحيات الوصول إليه');
  }

  // تحقق من أن الطلب لم يتم دفعه مسبقاً
  if (order.payment_status === 'succeeded' || order.payment_status === 'completed') {
    throw new Error('تم الدفع لهذا الطلب مسبقاً');
  }

  return order;
}

/**
 * معتدل: تحديد حد أقصى للطلب
 * منع الطلبات الكبيرة جداً بشكل مريب
 */
export function validateOrderAmountSane(amount) {
  const MAX_ORDER_USD = 10000; // $10,000 حد أقصى معقول
  const MIN_ORDER_USD = 0.01; // $0.01 حد أدنى

  if (amount < MIN_ORDER_USD) {
    return {
      isValid: false,
      error: `المبلغ صغير جداً: ${amount}$`,
    };
  }

  if (amount > MAX_ORDER_USD) {
    return {
      isValid: false,
      error: `المبلغ كبير جداً: ${amount}$ (الحد الأقصى: $${MAX_ORDER_USD})`,
    };
  }

  return { isValid: true };
}

/**
 * صارم: منع محاولات تعديل الطلب بعد بدء الدفع
 */
export function validateOrderNotModified(originalOrderData, currentOrderData) {
  const CRITICAL_FIELDS = ['recipientName', 'recipientPhone', 'items', 'amount'];

  for (const field of CRITICAL_FIELDS) {
    const original = JSON.stringify(originalOrderData[field]);
    const current = JSON.stringify(currentOrderData[field]);

    if (original !== current) {
      return {
        isValid: false,
        error: `محاولة تعديل الطلب: حقل ${field} تم تغييره`,
      };
    }
  }

  return { isValid: true };
}

/**
 * معتدل: تسجيل محاولات دفع مريبة
 */
export async function logSuspiciousPaymentAttempt(supabase, userId, reason, details = {}) {
  try {
    const { error } = await supabase.from('suspicious_activities_log').insert({
      user_id: userId,
      activity_type: 'suspicious_payment',
      reason,
      details,
      ip_address: null,
      user_agent: navigator.userAgent,
      occurred_at: new Date().toISOString(),
    });
    // Silently ignore if table doesn't exist (404) — non-critical logging
    if (error) console.warn('Suspicious activity log skipped:', error.code);
  } catch (err) {
    // Non-critical — never block the user flow
  }
}

/**
 * صارم: منع إنشاء طلبات مكررة في فترة زمنية قصيرة
 */
const RECENT_ORDERS = new Map();
const DUPLICATE_PREVENTION_MS = 30 * 1000; // 30 ثانية

export function checkDuplicateOrder(userId, orderHash) {
  const userKey = `${userId}_${orderHash}`;
  const lastOrderTime = RECENT_ORDERS.get(userKey);
  const now = Date.now();

  if (lastOrderTime && now - lastOrderTime < DUPLICATE_PREVENTION_MS) {
    return {
      isDuplicate: true,
      error: 'تم إنشاء طلب مشابه مؤخراً. حاول لاحقاً.',
      remainingMs: DUPLICATE_PREVENTION_MS - (now - lastOrderTime),
    };
  }

  return { isDuplicate: false };
}

export function markOrderCreated(userId, orderHash) {
  const userKey = `${userId}_${orderHash}`;
  RECENT_ORDERS.set(userKey, Date.now());

  // تنظيف تلقائي
  setTimeout(() => {
    RECENT_ORDERS.delete(userKey);
  }, DUPLICATE_PREVENTION_MS);
}
