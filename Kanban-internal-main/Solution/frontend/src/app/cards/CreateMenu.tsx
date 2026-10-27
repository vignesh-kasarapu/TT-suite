// D-150: the Create button ("+ Create"), with the plane to create on in its menu. It sits in the
// board page header beside the Private / Org switch (it used to be in the top bar).
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../../components/Icon';
import { t } from '../../i18n/t';
import { NewCardDialog } from './NewCardDialog';
import s from './CreateMenu.module.css';

export function CreateMenu() {
  const navigate = useNavigate();
  const [plane, setPlane] = useState<'org' | 'private' | null>(null);
  const ref = useRef<HTMLDetailsElement>(null);
  const pick = (p: 'org' | 'private') => {
    ref.current?.removeAttribute('open');
    setPlane(p);
  };
  return (
    <>
      <details ref={ref} className={s.createMenu} data-popover data-testid="create-menu">
        <summary className={s.createButton} data-testid="create-open">
          <Icon name="plus" size={20} />
          <span className={s.createText}>{t('top.create')}</span>
          <Icon name="down" size={16} />
        </summary>
        <div className={s.createPanel}>
          <button type="button" onClick={() => pick('org')} data-testid="create-org">
            <Icon name="users" size={18} />
            {t('top.createOrg')}
          </button>
          <button type="button" onClick={() => pick('private')} data-testid="create-private">
            <Icon name="lock" size={18} />
            {t('top.createPrivate')}
          </button>
        </div>
      </details>
      {plane ? (
        <NewCardDialog
          ctx={{ plane, extra: {} }}
          onClose={() => setPlane(null)}
          onCreated={(key) =>
            void navigate(plane === 'org' ? `/org/cards/${key}` : `/cards/${key}`)
          }
        />
      ) : null}
    </>
  );
}
