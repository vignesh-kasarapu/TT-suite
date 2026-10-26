// Administration > Login issues (D-144): what people who cannot sign in wrote through "Message an
// admin" (D-125), open ones first. An admin marks one resolved; the server records who and when.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, EmptyState, Pill, Skeleton } from '../../components';
import { api, problemBanner, unwrap, type Problem } from '../../api/client';
import { t } from '../../i18n/t';
import c from '../cards/cards.module.css';
import o from '../org/org.module.css';
import s from './mail.module.css';

export const LOGIN_ISSUES_KEY = ['login-issues'];
const AT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function useLoginIssues(enabled = true) {
  return useQuery({
    queryKey: LOGIN_ISSUES_KEY,
    queryFn: async () => unwrap(await api.GET('/admin/login-issues')),
    enabled,
  });
}

export function AdminLoginIssues() {
  const queryClient = useQueryClient();
  const list = useLoginIssues();
  const [error, setError] = useState<string | null>(null);
  const resolve = useMutation({
    mutationFn: async (issueId: string) =>
      unwrap(
        await api.POST('/admin/login-issues/{issueId}/resolve', {
          params: { path: { issueId } },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(LOGIN_ISSUES_KEY, data);
      setError(null);
    },
    onError: (p: Problem) => setError(problemBanner(p)),
  });
  if (list.isPending) return <Skeleton lines={4} label={t('skeleton.label')} />;
  const items = list.data?.items ?? [];
  return (
    <section className={o.section} data-testid="admin-login-issues">
      <p className={c.hint}>{t('loginIssues.lead')}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {items.length === 0 ? (
        <EmptyState title={t('loginIssues.emptyTitle')} body={t('loginIssues.emptyBody')} />
      ) : (
        <ul className={s.issues}>
          {items.map((it) => (
            <li key={it.id} className={s.issue} data-testid="login-issue">
              <div className={s.issueHead}>
                <span className={s.previewSubject}>{it.name}</span>
                <a href={`mailto:${it.email}`} className={s.issueEmail}>
                  {it.email}
                </a>
                <span className={c.hint}>{AT.format(new Date(it.createdAt))}</span>
              </div>
              <div className={s.previewText}>{it.message}</div>
              <div className={s.issueFoot}>
                {it.resolvedAt ? (
                  <Pill tone="success">
                    {t('loginIssues.resolvedBy', {
                      name: it.resolvedByName ?? '',
                      when: AT.format(new Date(it.resolvedAt)),
                    })}
                  </Pill>
                ) : (
                  <>
                    <Pill tone="warning">{t('loginIssues.open')}</Pill>
                    <Button
                      onClick={() => resolve.mutate(it.id)}
                      busy={resolve.isPending && resolve.variables === it.id}
                      data-testid="login-issue-resolve"
                    >
                      {t('loginIssues.resolve')}
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
