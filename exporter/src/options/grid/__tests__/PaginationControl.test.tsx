import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@solidjs/testing-library'

import PaginationControl from '../PaginationControl'

describe('PaginationControl', () => {
  const defaultProps = {
    currentPage: 1,
    totalPages: 5,
    totalCount: 100,
    pageSize: 20,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
  }

  describe('Req 3.8: Hidden when totalCount is 0', () => {
    it('renders nothing when totalCount is 0', () => {
      const { container } = render(() => (
        <PaginationControl {...defaultProps} totalCount={0} />
      ))
      expect(container.innerHTML).toBe('')
    })

    it('renders when totalCount is greater than 0', () => {
      const { container } = render(() => (
        <PaginationControl {...defaultProps} totalCount={1} />
      ))
      expect(container.innerHTML).not.toBe('')
    })
  })

  describe('Req 3.1: Display current page and total pages', () => {
    it('shows "Page X of Y" text', () => {
      render(() => (
        <PaginationControl
          {...defaultProps}
          currentPage={2}
          totalPages={5}
        />
      ))
      expect(screen.getByText('Page 2 of 5')).toBeInTheDocument()
    })
  })

  describe('Req 3.4: Previous button disabled on first page', () => {
    it('disables previous button when on page 1', () => {
      render(() => (
        <PaginationControl {...defaultProps} currentPage={1} />
      ))
      const prevBtn = screen.getByLabelText('Previous page')
      expect(prevBtn).toBeDisabled()
    })

    it('enables previous button when not on page 1', () => {
      render(() => (
        <PaginationControl {...defaultProps} currentPage={2} />
      ))
      const prevBtn = screen.getByLabelText('Previous page')
      expect(prevBtn).not.toBeDisabled()
    })
  })

  describe('Req 3.5: Next button disabled on last page', () => {
    it('disables next button when on last page', () => {
      render(() => (
        <PaginationControl
          {...defaultProps}
          currentPage={5}
          totalPages={5}
        />
      ))
      const nextBtn = screen.getByLabelText('Next page')
      expect(nextBtn).toBeDisabled()
    })

    it('enables next button when not on last page', () => {
      render(() => (
        <PaginationControl
          {...defaultProps}
          currentPage={3}
          totalPages={5}
        />
      ))
      const nextBtn = screen.getByLabelText('Next page')
      expect(nextBtn).not.toBeDisabled()
    })
  })

  describe('Req 3.2: Next page navigation', () => {
    it('calls onPageChange with next page on click', () => {
      const onPageChange = vi.fn()
      render(() => (
        <PaginationControl
          {...defaultProps}
          currentPage={2}
          onPageChange={onPageChange}
        />
      ))
      fireEvent.click(screen.getByLabelText('Next page'))
      expect(onPageChange).toHaveBeenCalledWith(3)
    })
  })

  describe('Req 3.3: Previous page navigation', () => {
    it('calls onPageChange with previous page on click', () => {
      const onPageChange = vi.fn()
      render(() => (
        <PaginationControl
          {...defaultProps}
          currentPage={3}
          onPageChange={onPageChange}
        />
      ))
      fireEvent.click(screen.getByLabelText('Previous page'))
      expect(onPageChange).toHaveBeenCalledWith(2)
    })
  })

  describe('Req 3.6, 3.7: Page size selector', () => {
    it('renders page size options 20, 50, 100', () => {
      render(() => <PaginationControl {...defaultProps} />)
      const select = screen.getByRole('combobox')
      const options = select.querySelectorAll('option')
      const values = Array.from(options).map((o) => Number(o.value))
      expect(values).toEqual([20, 50, 100])
    })

    it('calls onPageSizeChange when page size is changed', () => {
      const onPageSizeChange = vi.fn()
      render(() => (
        <PaginationControl
          {...defaultProps}
          onPageSizeChange={onPageSizeChange}
        />
      ))
      const select = screen.getByRole('combobox')
      fireEvent.change(select, { target: { value: '50' } })
      expect(onPageSizeChange).toHaveBeenCalledWith(50)
    })

    it('shows current page size as selected value', () => {
      render(() => (
        <PaginationControl {...defaultProps} pageSize={50} />
      ))
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('50')
    })
  })
})
