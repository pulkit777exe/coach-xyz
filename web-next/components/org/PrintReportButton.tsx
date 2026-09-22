'use client'

import { PrinterIcon } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'

export default function PrintReportButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
      <PrinterIcon /> Print
    </Button>
  )
}
