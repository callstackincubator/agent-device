import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppFrame } from '../../src/components';
import { LAB_PRODUCTS } from '../../src/data';
import { useLabState } from '../../src/lab-state';
import { ProductScreen } from '../../src/screens/ProductScreen';

export default function ProductRoute() {
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  const router = useRouter();
  const state = useLabState();
  const product = LAB_PRODUCTS.find((entry) => entry.id === productId) ?? LAB_PRODUCTS[0]!;
  const draft = state.detailDrafts[product.id] ?? { note: '', quantity: 1 };

  return (
    <AppFrame>
      <ProductScreen
        detailNote={draft.note}
        isFavorite={state.favoriteIds.includes(product.id)}
        onBack={() => router.replace('/catalog')}
        onChangeDetailNote={(value) => state.setProductNote(product.id, value)}
        onDecreaseQuantity={() => state.decreaseProductQuantity(product.id)}
        onIncreaseQuantity={() => state.increaseProductQuantity(product.id)}
        onSave={() => {
          state.saveProductToCart(product.id);
          router.replace('/catalog');
        }}
        onToggleFavorite={() => state.toggleFavorite(product.id)}
        product={product}
        quantity={draft.quantity}
      />
    </AppFrame>
  );
}
