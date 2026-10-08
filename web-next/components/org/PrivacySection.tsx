'use client'

import { useEffect, useState } from 'react'

import Section from '@/components/org/Section'
import SettingRow from '@/components/org/SettingRow'
import { Spinner } from '@/components/org/Spinner'
import { Button } from '@/components/9ui/ui/button'
import { Switch } from '@/components/9ui/ui/switch'
import { errorMessageOf } from '@/lib/errors'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/9ui/ui/dialog'
import {
  createMyPrivacyRequest,
  getMyConsent,
  getMyDataExport,
  listMyPrivacyRequests,
  updateMyConsent,
  type ConsentPurpose,
  type PlayerConsent,
  type PrivacyRequest,
} from '@/lib/meApi'

// ── Privacy & data rights ────────────────────────────────────────────────────
// Consent switches, an immediate self-service export, and a DELETION REQUEST
// that is honestly presented as a reviewed request: nothing is deleted when the
// button is pressed, and the copy must never imply otherwise.
//
// Takes no props — every call is self-scoped, so the settings panel renders it
// as `<PrivacySection />` the same way it renders NotificationsSection.

const PURPOSE_COPY: Record<ConsentPurpose, { title: string; description: string }> = {
  trainingData: {
    title: 'Training data',
    description:
      'Let your coach use your match and drill videos, analysis results and attendance to build your training plan.',
  },
  medicalData: {
    title: 'Health and medical information',
    description:
      'Let your coach record injuries and wellness check-ins so training is adapted around your fitness.',
  },
  marketing: {
    title: 'Product and coaching updates',
    description:
      'Send me occasional emails about features, camps and coaching opportunities. Transactional emails are always sent.',
  },
}

const PURPOSES = Object.keys(PURPOSE_COPY) as ConsentPurpose[]

const REQUEST_STATUS_COPY: Record<PrivacyRequest['status'], string> = {
  received: 'Received — waiting for review',
  in_progress: 'In review',
  completed: 'Completed',
  declined: 'Declined',
}

/** The date half of an ISO stamp (matches the server's export filename). */
const dayOf = (iso: string): string => iso.slice(0, 10)

/** Triggers a JSON download in the browser (same shape as lib/csv downloadCSV). */
function downloadJson(filename: string, data: unknown): void {
  const url = window.URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.URL.revokeObjectURL(url)
}

export default function PrivacySection() {
  const [consent, setConsent] = useState<PlayerConsent | null>(null)
  const [requests, setRequests] = useState<PrivacyRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isRequesting, setIsRequesting] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    // Both reads are independent; allSettled keeps a failing request history
    // from taking the consent switches down with it.
    void Promise.allSettled([getMyConsent(), listMyPrivacyRequests()]).then(
      ([consentResult, requestsResult]) => {
        if (!active) return
        if (consentResult.status === 'fulfilled') {
          setConsent(consentResult.value)
        } else {
          setError(errorMessageOf(consentResult.reason, 'Failed to load consent settings.'))
        }
        if (requestsResult.status === 'fulfilled') setRequests(requestsResult.value.requests)
        setIsLoading(false)
      },
    )

    return () => {
      active = false
    }
  }, [])

  const updatePurpose = (purpose: ConsentPurpose, enabled: boolean) => {
    if (!consent || !consent.linked || isSaving) return
    const previous = consent
    setConsent({ ...consent, [purpose]: enabled })
    setError(null)
    setIsSaving(true)

    void updateMyConsent({ [purpose]: enabled })
      .then((saved) => setConsent(saved))
      .catch((cause) => {
        setConsent(previous)
        setError(errorMessageOf(cause, 'Failed to save consent.'))
      })
      .finally(() => setIsSaving(false))
  }

  const downloadMyData = () => {
    if (isExporting) return
    setIsExporting(true)
    setError(null)
    setNotice(null)

    void getMyDataExport()
      .then((bundle) => {
        downloadJson(`coachxyz-export-${dayOf(bundle.exportedAt)}.json`, bundle)
        setNotice('Your data was downloaded as a JSON file.')
      })
      .catch((cause) => {
        setError(errorMessageOf(cause, 'Failed to download your data.'))
      })
      .finally(() => setIsExporting(false))
  }

  const requestDeletion = () => {
    if (isRequesting) return
    setIsRequesting(true)
    setError(null)

    void createMyPrivacyRequest('delete')
      .then(({ request }) => {
        setIsDeleteOpen(false)
        setNotice(
          `Deletion request received on ${dayOf(request.createdAt)}. Nothing has been deleted yet — we confirm by email once it has been reviewed.`,
        )
        // The POST response is authoritative for the new row; the refreshed
        // list replaces it with the server's own ordering.
        void listMyPrivacyRequests()
          .then((body) => setRequests(body.requests))
          .catch(() => setRequests((current) => [request, ...current]))
      })
      .catch((cause) => {
        setError(errorMessageOf(cause, 'Failed to send your deletion request.'))
      })
      .finally(() => setIsRequesting(false))
  }

  const hasNoLinkedPlayer = consent !== null && !consent.linked

  return (
    <Section title="Privacy & data">
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : (
        <>
          <p className="mb-1 text-meta font-medium leading-[1.4] text-foreground">Consent</p>
          {hasNoLinkedPlayer ? (
            <p className="mb-3 rounded-[6px] border border-border bg-muted px-3 py-2.5 text-meta leading-[1.5] text-muted-foreground">
              This account is not linked to a player record, so there is nothing to record consent
              for. Ask your coach to link it if you expect to see training data here — your export
              and deletion request below still work.
            </p>
          ) : null}
          <div className={hasNoLinkedPlayer ? 'opacity-60' : undefined}>
            {PURPOSES.map((purpose) => (
              <SettingRow
                key={purpose}
                title={PURPOSE_COPY[purpose].title}
                description={PURPOSE_COPY[purpose].description}
              >
                <Switch
                  checked={consent?.[purpose] ?? false}
                  onCheckedChange={(enabled) => updatePurpose(purpose, enabled)}
                  disabled={isSaving || hasNoLinkedPlayer}
                  aria-label={PURPOSE_COPY[purpose].title}
                />
              </SettingRow>
            ))}
          </div>
          {consent?.linked ? (
            <p className="mt-2 text-caption leading-[1.5] text-muted-foreground">
              Recorded under policy version {consent.policyVersion}
              {consent.updatedAt ? ` · last changed ${dayOf(consent.updatedAt)}` : ''}. Turning
              something off applies immediately; turning it back on records the new choice.
            </p>
          ) : null}

          {isSaving ? (
            <div
              className="mt-4 flex items-center gap-2 text-meta text-muted-foreground"
              role="status"
            >
              <Spinner />
              Saving consent…
            </div>
          ) : null}

          <p className="mb-1 mt-8 text-meta font-medium leading-[1.4] text-foreground">Your data</p>
          <div>
            <SettingRow
              title="Download my data"
              description="A JSON copy of everything on your account — profile, player record, attendance, schedule, performance, analyses, reports, objectives, notifications and consent. Ready immediately."
            >
              <Button variant="outline" size="sm" onClick={downloadMyData} disabled={isExporting}>
                {isExporting ? <Spinner /> : null}
                {isExporting ? 'Preparing…' : 'Download'}
              </Button>
            </SettingRow>
            <SettingRow
              title="Request account deletion"
              description="Sends a deletion request to our team. Nothing is deleted straight away — we review each request, then confirm by email."
            >
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setIsDeleteOpen(true)}
                disabled={isRequesting}
              >
                Request deletion
              </Button>
            </SettingRow>
          </div>

          {requests.length > 0 ? (
            <div className="mt-4">
              <p className="text-meta font-medium leading-[1.4] text-foreground">Your requests</p>
              <ul>
                {requests.map((request) => (
                  <li
                    key={request.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border py-2.5 text-meta last:border-b-0"
                  >
                    <span className="text-foreground">
                      {request.type === 'delete' ? 'Account deletion' : 'Data copy'}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {dayOf(request.createdAt)} · {REQUEST_STATUS_COPY[request.status]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {notice ? (
            <p className="mt-4 text-meta leading-[1.5] text-muted-foreground" role="status">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p
              className="mt-4 rounded-[6px] border border-destructive/20 bg-destructive/10 px-3 py-2 text-body text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </>
      )}

      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request account deletion</DialogTitle>
            <DialogDescription>
              This records a request for us to review. It is not an immediate deletion: your
              account, videos, analyses and reports stay exactly as they are until a person has
              checked the request and confirmed it to you by email.
            </DialogDescription>
          </DialogHeader>
          <p className="text-meta leading-[1.5] text-muted-foreground">
            If you only want a copy of your data, use Download instead — that is instant and needs
            no review.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={requestDeletion} disabled={isRequesting}>
              {isRequesting ? <Spinner /> : null}
              {isRequesting ? 'Sending…' : 'Send deletion request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}
