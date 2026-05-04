import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import './BookNowPage.css'
import { supabase } from '../supabase'

type DbRoomType = 'Double' | 'Deluxe' | 'Family'

type RoomRow = {
  id: string
  room_number: string
  room_type: DbRoomType
  price_per_night: number
}

type BookingRow = {
  room_id: string
}

function formatReadableDate(value: string | null) {
  if (!value) return '-'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function getDefaultGuests(roomType: string) {
  const lower = roomType.toLowerCase()
  if (lower.includes('family')) return '4'
  if (lower.includes('deluxe')) return '2'
  return '2'
}

function getMaxGuests(roomType: string) {
  const lower = roomType.toLowerCase()
  if (lower.includes('family')) return 4
  if (lower.includes('deluxe')) return 3
  return 2
}

function normalizeRoomType(value: string | null): DbRoomType {
  if (!value) return 'Double'
  if (value === 'Family' || value.toLowerCase().includes('family')) return 'Family'
  if (value === 'Deluxe' || value.toLowerCase().includes('deluxe')) return 'Deluxe'
  return 'Double'
}

export default function BookNowPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const bookingData = useMemo(() => {
    const roomTypeParam = searchParams.get('roomType')
    const roomLabel = searchParams.get('roomLabel') || roomTypeParam || 'Double'
    const price = searchParams.get('price') || '0'
    const checkIn = searchParams.get('checkIn')
    const checkOut = searchParams.get('checkOut')
    const nights = searchParams.get('nights') || '0'
    const total = searchParams.get('total') || '0'

    return {
      roomTypeDb: normalizeRoomType(roomTypeParam || roomLabel),
      roomLabel,
      price,
      checkIn,
      checkOut,
      nights,
      total,
      maxGuests: getMaxGuests(roomLabel),
    }
  }, [searchParams])

  const [guestName, setGuestName] = useState('')
  const [email, setEmail] = useState('')
  const [contactNumber, setContactNumber] = useState('')
  const [numberOfGuests, setNumberOfGuests] = useState(getDefaultGuests(bookingData.roomLabel))
  const [arrivalTime, setArrivalTime] = useState('')
  const [specialRequests, setSpecialRequests] = useState('')
  const [agreeToTerms, setAgreeToTerms] = useState(false)

  const [nameError, setNameError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [contactError, setContactError] = useState('')
  const [guestsError, setGuestsError] = useState('')
  const [termsError, setTermsError] = useState('')
  const [submitError, setSubmitError] = useState('')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [bookingCompleted, setBookingCompleted] = useState(false)
  const [successModalOpen, setSuccessModalOpen] = useState(false)
  const [assignedRoomNumber, setAssignedRoomNumber] = useState('')

  const formLocked = isSubmitting || bookingCompleted

  function resetErrors() {
    setNameError('')
    setEmailError('')
    setContactError('')
    setGuestsError('')
    setTermsError('')
    setSubmitError('')
  }

  function validateEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  }

  async function findAvailableRoom(
    roomType: DbRoomType,
    checkIn: string,
    checkOut: string
  ): Promise<RoomRow | null> {
    const { data: rooms, error: roomError } = await supabase
      .from('rooms')
      .select('id, room_number, room_type, price_per_night')
      .eq('room_type', roomType)
      .eq('status', 'Available')
      .order('room_number', { ascending: true })

    if (roomError) throw roomError
    if (!rooms || rooms.length === 0) return null

    const roomIds = rooms.map((room) => room.id)

    const { data: conflictingBookings, error: bookingError } = await supabase
      .from('bookings')
      .select('room_id')
      .in('room_id', roomIds)
      .in('status', ['Reserved', 'CheckedIn'])
      .lt('check_in', checkOut)
      .gt('check_out', checkIn)

    if (bookingError) throw bookingError

    const occupiedIds = new Set(
      (conflictingBookings as BookingRow[] | null)?.map((b) => b.room_id) ?? []
    )

    const availableRoom =
      (rooms as RoomRow[]).find((room) => !occupiedIds.has(room.id)) ?? null

    return availableRoom
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (isSubmitting || bookingCompleted) return

    resetErrors()

    let hasError = false
    const guestCount = Number(numberOfGuests)

    if (!guestName.trim()) {
      setNameError('Please enter your full name.')
      hasError = true
    }

    if (!email.trim()) {
      setEmailError('Please enter your email address.')
      hasError = true
    } else if (!validateEmail(email)) {
      setEmailError('Please enter a valid email address.')
      hasError = true
    }

    if (!contactNumber.trim()) {
      setContactError('Please enter your contact number.')
      hasError = true
    }

    if (!numberOfGuests.trim() || guestCount <= 0) {
      setGuestsError('Please enter a valid number of guests.')
      hasError = true
    } else if (guestCount > bookingData.maxGuests) {
      setGuestsError(
        `The selected ${bookingData.roomLabel} only allows up to ${bookingData.maxGuests} guest${bookingData.maxGuests > 1 ? 's' : ''}.`
      )
      hasError = true
    }

    if (!agreeToTerms) {
      setTermsError('Please agree to the booking terms.')
      hasError = true
    }

    if (!bookingData.checkIn || !bookingData.checkOut) {
      setSubmitError('Missing check-in or check-out date from the Availability page.')
      hasError = true
    }

    if (hasError) return

    try {
      setIsSubmitting(true)

      const availableRoom = await findAvailableRoom(
        bookingData.roomTypeDb,
        bookingData.checkIn!,
        bookingData.checkOut!
      )

      if (!availableRoom) {
        setSubmitError('No available room was found for the selected date range.')
        return
      }

      const { data: guestInsert, error: guestError } = await supabase
        .from('guests')
        .insert({
          full_name: guestName,
          email,
          contact_number: contactNumber,
        })
        .select('id')
        .single()

      if (guestError) throw guestError

      const nights = Number(bookingData.nights)
      const totalPrice = Number(bookingData.total)

      const { error: bookingError } = await supabase
        .from('bookings')
        .insert({
          guest_id: guestInsert.id,
          room_id: availableRoom.id,
          check_in: bookingData.checkIn,
          check_out: bookingData.checkOut,
          nights,
          total_price: totalPrice,
          status: 'Reserved',
          guest_count: guestCount,
          arrival_time: arrivalTime || null,
          special_requests: specialRequests || null,
        })

      if (bookingError) throw bookingError

      setAssignedRoomNumber(availableRoom.room_number)
      setBookingCompleted(true)
      setSuccessModalOpen(true)

      setGuestName('')
      setEmail('')
      setContactNumber('')
      setArrivalTime('')
      setSpecialRequests('')
      setAgreeToTerms(false)
    } catch (error: any) {
      setSubmitError(error.message || 'Failed to submit booking.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="book-page">
      <header className="book-page-header">
        <div className="book-page-brand">
          <div className="book-page-brand-title">ALL-DAY TRAVELLERS INN</div>
          <div className="book-page-brand-subtitle">Your Home Away From Home</div>
        </div>

        <nav className="book-page-nav">
          <button type="button" onClick={() => navigate('/')} className="book-page-nav-link">
            Back to Availability
          </button>
        </nav>
      </header>

      <main className="book-page-content">
        <section className="book-page-hero">
          <span className="book-page-badge">Booking Form</span>
          <h1>Book Now</h1>
          <p>Complete the guest details below to continue your reservation.</p>
        </section>

        {submitError && (
          <div
            style={{
              background: '#FFF1F1',
              border: '1px solid rgba(214, 40, 40, 0.22)',
              color: '#D62828',
              padding: '14px 16px',
              borderRadius: '14px',
              marginBottom: '18px',
              fontWeight: 600,
            }}
          >
            {submitError}
          </div>
        )}

        <div className="book-page-layout">
          <section className="book-form-card">
            <div className="book-section-head">
              <div>
                <h2>Guest Information</h2>
                <p>
                  {bookingCompleted
                    ? 'This booking has already been submitted successfully.'
                    : 'Fill in the required details for the reservation.'}
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="book-form">
              <div className="book-form-grid">
                <div className="book-field full-width">
                  <label htmlFor="guestName">Full Name</label>
                  <input
                    id="guestName"
                    type="text"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="Enter your full name"
                    disabled={formLocked}
                  />
                  {nameError && <span className="field-error">{nameError}</span>}
                </div>

                <div className="book-field">
                  <label htmlFor="email">Email Address</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    disabled={formLocked}
                  />
                  {emailError && <span className="field-error">{emailError}</span>}
                </div>

                <div className="book-field">
                  <label htmlFor="contactNumber">Contact Number</label>
                  <input
                    id="contactNumber"
                    type="text"
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value)}
                    placeholder="Enter your contact number"
                    disabled={formLocked}
                  />
                  {contactError && <span className="field-error">{contactError}</span>}
                </div>

                <div className="book-field">
                  <label htmlFor="numberOfGuests">Number of Guests</label>
                  <input
                    id="numberOfGuests"
                    type="number"
                    min="1"
                    max={bookingData.maxGuests}
                    value={numberOfGuests}
                    onChange={(e) => setNumberOfGuests(e.target.value)}
                    placeholder="Enter number of guests"
                    disabled={formLocked}
                  />
                  {guestsError && <span className="field-error">{guestsError}</span>}
                </div>

                <div className="book-field">
                  <label htmlFor="arrivalTime">Estimated Arrival Time</label>
                  <input
                    id="arrivalTime"
                    type="time"
                    value={arrivalTime}
                    onChange={(e) => setArrivalTime(e.target.value)}
                    disabled={formLocked}
                  />
                </div>

                <div className="book-field full-width">
                  <label htmlFor="specialRequests">Special Requests</label>
                  <textarea
                    id="specialRequests"
                    value={specialRequests}
                    onChange={(e) => setSpecialRequests(e.target.value)}
                    placeholder="Add any special request here"
                    rows={5}
                    disabled={formLocked}
                  />
                </div>
              </div>

              <div className="book-readonly-card">
                <h3>Selected Stay Details</h3>
                <div className="book-readonly-grid">
                  {assignedRoomNumber && (
                    <div className="book-readonly-item">
                      <span>Assigned Room</span>
                      <strong>{assignedRoomNumber}</strong>
                    </div>
                  )}

                  <div className="book-readonly-item">
                    <span>Room Type</span>
                    <strong>{bookingData.roomLabel}</strong>
                  </div>

                  <div className="book-readonly-item">
                    <span>Price per Night</span>
                    <strong>₱{bookingData.price}</strong>
                  </div>

                  <div className="book-readonly-item">
                    <span>Check-in</span>
                    <strong>{formatReadableDate(bookingData.checkIn)}</strong>
                  </div>

                  <div className="book-readonly-item">
                    <span>Check-out</span>
                    <strong>{formatReadableDate(bookingData.checkOut)}</strong>
                  </div>
                </div>
              </div>

              <div className="book-terms-box">
                <label className="book-checkbox-row">
                  <input
                    type="checkbox"
                    checked={agreeToTerms}
                    onChange={(e) => setAgreeToTerms(e.target.checked)}
                    disabled={formLocked}
                  />
                  <span>
                    I confirm that the booking details are correct and I agree to the inn’s policies.
                  </span>
                </label>
                {termsError && <span className="field-error">{termsError}</span>}
              </div>

              <div className="book-form-actions">
                <button
                  type="button"
                  className="book-secondary-btn"
                  onClick={() => navigate('/')}
                >
                  Back
                </button>

                <button type="submit" className="book-primary-btn" disabled={formLocked}>
                  {bookingCompleted
                    ? 'Reservation Confirmed'
                    : isSubmitting
                    ? 'Submitting...'
                    : 'Confirm Reservation'}
                </button>
              </div>
            </form>
          </section>

          <aside className="book-summary-card">
            <div className="book-summary-top">
              <h2>Booking Summary</h2>
              <span className="book-summary-badge">
                {bookingCompleted ? 'Confirmed' : 'Final Step'}
              </span>
            </div>

            <div className="book-summary-main">
              {assignedRoomNumber && (
                <div className="book-summary-row">
                  <span>Assigned Room</span>
                  <strong>{assignedRoomNumber}</strong>
                </div>
              )}

              <div className="book-summary-row">
                <span>Room</span>
                <strong>{bookingData.roomLabel}</strong>
              </div>

              <div className="book-summary-row">
                <span>Check-in</span>
                <strong>{formatReadableDate(bookingData.checkIn)}</strong>
              </div>

              <div className="book-summary-row">
                <span>Check-out</span>
                <strong>{formatReadableDate(bookingData.checkOut)}</strong>
              </div>

              <div className="book-summary-row">
                <span>Nights</span>
                <strong>{bookingData.nights}</strong>
              </div>

              <div className="book-summary-row">
                <span>Rate</span>
                <strong>₱{bookingData.price}</strong>
              </div>

              <hr />

              <div className="book-summary-total">
                <span>Total</span>
                <strong>₱{bookingData.total}</strong>
              </div>
            </div>

            <div className="book-contact-card">
              <h3>Contact Us</h3>
              <p>Purok 6, Brgy. Montana, Baclayon, Bohol 6301</p>
              <p>0994.977.3776</p>
              <p>dailytravellersinn@outlook.com</p>
            </div>
          </aside>
        </div>
      </main>

      {successModalOpen && (
        <div
          onClick={() => setSuccessModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(16, 24, 40, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '520px',
              background: '#ffffff',
              borderRadius: '24px',
              border: '1px solid #dce3ec',
              boxShadow: '0 24px 60px rgba(15, 23, 42, 0.22)',
              padding: '28px',
              textAlign: 'center',
              fontFamily: 'Poppins, sans-serif',
            }}
          >
            <div
              style={{
                width: '72px',
                height: '72px',
                margin: '0 auto 18px',
                borderRadius: '999px',
                background: 'rgba(24, 181, 74, 0.12)',
                color: '#18b54a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '2rem',
                fontWeight: 800,
              }}
            >
              ✓
            </div>

            <h3
              style={{
                margin: '0 0 10px',
                fontSize: '1.7rem',
                fontWeight: 800,
                color: '#102347',
              }}
            >
              Booking Confirmed
            </h3>

            <p
              style={{
                margin: '0 0 18px',
                color: '#5f708a',
                lineHeight: 1.6,
              }}
            >
              Your reservation has been submitted successfully.
            </p>

            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e5e7eb',
                borderRadius: '18px',
                padding: '16px',
                marginBottom: '22px',
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '12px',
                  marginBottom: '10px',
                }}
              >
                <span style={{ color: '#5f708a' }}>Assigned Room</span>
                <strong style={{ color: '#102347' }}>{assignedRoomNumber}</strong>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '12px',
                  marginBottom: '10px',
                }}
              >
                <span style={{ color: '#5f708a' }}>Room Type</span>
                <strong style={{ color: '#102347' }}>{bookingData.roomLabel}</strong>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <span style={{ color: '#5f708a' }}>Stay</span>
                <strong style={{ color: '#102347', textAlign: 'right' }}>
                  {formatReadableDate(bookingData.checkIn)} – {formatReadableDate(bookingData.checkOut)}
                </strong>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <button
                onClick={() => setSuccessModalOpen(false)}
                style={{
                  border: 'none',
                  borderRadius: '14px',
                  padding: '12px 18px',
                  fontWeight: 700,
                  fontFamily: 'Poppins, sans-serif',
                  cursor: 'pointer',
                  background: '#eef2f7',
                  color: '#334155',
                }}
              >
                Stay on Page
              </button>

              <button
                onClick={() => navigate('/')}
                style={{
                  border: 'none',
                  borderRadius: '14px',
                  padding: '12px 18px',
                  fontWeight: 700,
                  fontFamily: 'Poppins, sans-serif',
                  cursor: 'pointer',
                  background: '#E87F24',
                  color: '#ffffff',
                }}
              >
                Back to Availability
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}