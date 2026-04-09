import { AppFrame } from '../../src/components';
import { useLabState } from '../../src/lab-state';
import { FormScreen } from '../../src/screens/FormScreen';

export default function FormRoute() {
  const state = useLabState();

  return (
    <AppFrame>
      <FormScreen
        errors={state.formErrors}
        form={state.form}
        onChange={state.updateForm}
        onReset={state.resetForm}
        onSubmit={state.submitOrder}
        submittedSummary={state.submittedSummary}
      />
    </AppFrame>
  );
}
