import { useRouter } from 'expo-router';

import { AppFrame } from '../../src/components';
import { useLabState } from '../../src/lab-state';
import { CatalogScreen } from '../../src/screens/CatalogScreen';

export default function CatalogRoute() {
  const router = useRouter();
  const state = useLabState();

  return (
    <AppFrame>
      <CatalogScreen
        activeCategory={state.activeCategory}
        cart={state.cartCounts}
        favorites={new Set(state.favoriteIds)}
        onAddToCart={state.addToCart}
        onOpenDetails={(productId) => router.push(`/product/${productId}`)}
        onSearchDraftChange={state.setSearchDraft}
        onSelectCategory={state.setActiveCategory}
        onToggleFavorite={state.toggleFavorite}
        products={state.catalogProducts}
        searchDraft={state.searchDraft}
      />
    </AppFrame>
  );
}
