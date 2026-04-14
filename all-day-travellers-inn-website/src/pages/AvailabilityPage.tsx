import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './AvailabilityPage.css'
import { supabase } from '../supabase'

type StatusType = 'available' | 'limited' | 'booked'
type DbRoomType = 'Double' | 'Deluxe' | 'Family'
type BookingStatus = 'Reserved' | 'CheckedIn' | 'CheckedOut' | 'Cancelled'

type Room = {
  id: string
  room_number: string
  room_type: DbRoomType
  price_per_night: number
  status: string
}

type Booking = {
  id: string
  room_id: string
  check_in: string
  check_out: string
  status: BookingStatus
}

type RoomDefinition = {
  dbType: DbRoomType
  label: string
  capacity: string
  description: string
  tag: string
  features: string[]
  fallbackPrice: number
  fallbackRooms: number
}

const BOOK_NOW_PATH = '/book-now'

const ROOM_DEFINITIONS: RoomDefinition[] = [
  {
    dbType: 'Double',
    label: 'Double Room',
    capacity: '2 Guests',
    description: 'Best for simple and budget-friendly stay.',
    tag: 'Budget Friendly',
    features: ['Air-conditioned', 'Free Wi-Fi', 'Private bathroom'],
    fallbackPrice: 1200,
    fallbackRooms: 3,
  },
  {
    dbType: 'Deluxe',
    label: 'Deluxe Room',
    capacity: '2–3 Guests',
    description: 'More space and upgraded comfort.',
    tag: 'Most Popular',
    features: ['Larger room', 'Hot shower', 'Work desk'],
    fallbackPrice: 1800,
    fallbackRooms: 3,
  },
  {
    dbType: 'Family',
    label: 'Family Suite',
    capacity: '4 Guests',
    description: 'Ideal for family trips and longer stays.',
    tag: 'Best for Groups',
    features: ['Extra beds', 'Spacious layout', 'Family-friendly'],
    fallbackPrice: 2500,
    fallbackRooms: 2,
  },
]

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const dialogRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '16px',
  padding: '12px 14px',
  borderRadius: '14px',
  background: '#f8fafc',
  border: '1px solid #e5e7eb',
  color: '#475569',
} as const

function getDaysInMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
}

function normalizeDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function toIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDate(date: Date | null) {
  if (!date) return '-'
  return `${monthNames[date.getMonth()].slice(0, 3)} ${date.getDate()}, ${date.getFullYear()}`
}

function differenceInNights(start: Date | null, end: Date | null) {
  if (!start || !end) return 0
  const ms = normalizeDate(end).getTime() - normalizeDate(start).getTime()
  return ms > 0 ? Math.round(ms / (1000 * 60 * 60 * 24)) : 0
}

export default function AvailabilityPage() {
  const navigate = useNavigate()

  const [currentMonth, setCurrentMonth] = useState(new Date(2026, 3, 1))
  const [selectedRoomType, setSelectedRoomType] = useState<DbRoomType>('Family')
  const [checkIn, setCheckIn] = useState<Date | null>(null)
  const [checkOut, setCheckOut] = useState<Date | null>(null)

  const [rooms, setRooms] = useState<Room[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])

  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [warningMessage, setWarningMessage] = useState('')
  const [showBookingDialog, setShowBookingDialog] = useState(false)

  useEffect(() => {
    fetchAvailabilityData()
  }, [])

  async function fetchAvailabilityData() {
    try {
      setLoading(true)
      setErrorMessage('')
      setWarningMessage('')

      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('id, room_number, room_type, price_per_night, status')
        .order('room_number', { ascending: true })

      if (roomError) throw roomError

      const { data: bookingData, error: bookingError } = await supabase
        .from('bookings')
        .select('id, room_id, check_in, check_out, status')
        .in('status', ['Reserved', 'CheckedIn'])

      if (bookingError) throw bookingError

      const safeRooms = ((roomData ?? []) as Room[]).map((room) => ({
        ...room,
        price_per_night: Number(room.price_per_night),
      }))

      const safeBookings = (bookingData ?? []) as Booking[]

      setRooms(safeRooms)
      setBookings(safeBookings)

      if (safeRooms.length === 0) {
        setWarningMessage(
          'No room records were found yet, so only fallback display values are showing.'
        )
      }
    } catch (error: any) {
      setRooms([])
      setBookings([])
      setWarningMessage('')
      setErrorMessage(error.message || 'Failed to load availability data.')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const roomCards = useMemo(() => {
    return ROOM_DEFINITIONS.map((definition) => {
      const directRooms = rooms.filter((room) => room.room_type === definition.dbType)

      if (directRooms.length > 0) {
        return {
          ...definition,
          price: directRooms[0].price_per_night,
          totalRooms: directRooms.length,
        }
      }

      return {
        ...definition,
        price: definition.fallbackPrice,
        totalRooms: definition.fallbackRooms,
      }
    })
  }, [rooms])

  const selectedInfo =
    roomCards.find((room) => room.dbType === selectedRoomType) ?? roomCards[2]

  const selectedDirectRooms = useMemo(
    () => rooms.filter((room) => room.room_type === selectedRoomType),
    [rooms, selectedRoomType]
  )

  function getBookedCountForDay(day: number) {
    const dayIso = toIsoDate(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day)
    )

    if (selectedDirectRooms.length > 0) {
      const occupiedRoomIds = new Set(
        bookings
          .filter((booking) => {
            const roomMatch = selectedDirectRooms.some((room) => room.id === booking.room_id)
            if (!roomMatch) return false
            return dayIso >= booking.check_in && dayIso < booking.check_out
          })
          .map((booking) => booking.room_id)
      )

      return occupiedRoomIds.size
    }

    return 0
  }

  function getStatus(day: number): StatusType {
    const totalRooms = selectedInfo.totalRooms
    const bookedCount = getBookedCountForDay(day)

    if (totalRooms <= 0) return 'available'
    if (bookedCount >= totalRooms) return 'booked'
    if (bookedCount > 0) return 'limited'
    return 'available'
  }

  function hasRoomForRange(startDate: Date, endDate: Date) {
    let cursor = new Date(startDate)

    while (cursor < endDate) {
      const dayIso = toIsoDate(cursor)

      if (selectedDirectRooms.length > 0) {
        const hasFreeRoom = selectedDirectRooms.some((room) => {
          return !bookings.some((booking) => {
            if (booking.room_id !== room.id) return false
            return dayIso >= booking.check_in && dayIso < booking.check_out
          })
        })

        if (!hasFreeRoom) return false
      }

      cursor.setDate(cursor.getDate() + 1)
    }

    return true
  }

  const daysInMonth = getDaysInMonth(currentMonth)
  const firstDayIndex = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth(),
    1
  ).getDay()

  const counts = useMemo(() => {
    let available = 0
    let limited = 0
    let booked = 0

    for (let day = 1; day <= daysInMonth; day++) {
      const status = getStatus(day)
      if (status === 'available') available++
      if (status === 'limited') limited++
      if (status === 'booked') booked++
    }

    return { available, limited, booked }
  }, [daysInMonth, rooms, bookings, currentMonth, selectedRoomType, selectedInfo.totalRooms])

  const calendarCells = useMemo(() => {
    const cells: Array<number | null> = []

    for (let i = 0; i < firstDayIndex; i++) {
      cells.push(null)
    }

    for (let day = 1; day <= daysInMonth; day++) {
      cells.push(day)
    }

    return cells
  }, [firstDayIndex, daysInMonth])

  const nights = differenceInNights(checkIn, checkOut)
  const total = nights * Number(selectedInfo.price || 0)
  const canProceed = !!checkIn && !!checkOut && hasRoomForRange(checkIn, checkOut)

  function isDateSelected(day: number) {
    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day)

    if (checkIn && !checkOut) {
      return normalizeDate(date).getTime() === normalizeDate(checkIn).getTime()
    }

    if (checkIn && checkOut) {
      const time = normalizeDate(date).getTime()
      return (
        time >= normalizeDate(checkIn).getTime() &&
        time <= normalizeDate(checkOut).getTime()
      )
    }

    return false
  }

  function handleDayClick(day: number) {
    const status = getStatus(day)
    if (status === 'booked') return

    const clickedDate = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      day
    )

    setErrorMessage('')

    if (!checkIn || (checkIn && checkOut)) {
      setCheckIn(clickedDate)
      setCheckOut(null)
      return
    }

    if (clickedDate.getTime() <= checkIn.getTime()) {
      setCheckIn(clickedDate)
      setCheckOut(null)
      return
    }

    if (!hasRoomForRange(checkIn, clickedDate)) {
      setErrorMessage('No room is available for the full selected range.')
      return
    }

    setCheckOut(clickedDate)
  }

  function handleRoomTypeSelect(roomType: DbRoomType) {
    setSelectedRoomType(roomType)
    setCheckIn(null)
    setCheckOut(null)
    setErrorMessage('')
  }

  function handlePrevMonth() {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
    )
    setCheckIn(null)
    setCheckOut(null)
    setErrorMessage('')
  }

  function handleNextMonth() {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
    )
    setCheckIn(null)
    setCheckOut(null)
    setErrorMessage('')
  }

  function handleResetDates() {
    setCheckIn(null)
    setCheckOut(null)
    setErrorMessage('')
  }

  function handleConfirmBooking() {
    if (!checkIn || !checkOut) return

    const params = new URLSearchParams({
      roomType: selectedRoomType,
      roomLabel: selectedInfo.label,
      price: String(selectedInfo.price),
      checkIn: toIsoDate(checkIn),
      checkOut: toIsoDate(checkOut),
      nights: String(nights),
      total: String(total),
    })

    setShowBookingDialog(false)
    navigate(`${BOOK_NOW_PATH}?${params.toString()}`)
  }

  return (
    <div className="availability-page">
      <header className="site-header">
        <div className="brand brand-text-only">
          <div>
            <div className="brand-title">ALL-DAY TRAVELLERS INN</div>
            <div className="brand-subtitle">Your Home Away From Home</div>
          </div>
        </div>

        <nav className="site-nav">
          <a href="#">Home</a>
          <a href="#">Rooms &amp; Rates</a>
          <a href="#" className="active-link">
            Availability
          </a>
          <a href="#">About</a>
          <a href="#">Contact</a>
        </nav>

        <div className="site-actions">
          <a href="#" className="ghost-link">
            My Reservations
          </a>
          <button className="book-now-btn">Book Now</button>
        </div>
      </header>

      <main className="availability-content">
        <section className="page-head">
          <div className="page-head-text">
            <span className="small-badge">Live Room Calendar</span>
            <h1>Check Availability</h1>
            <p>Select your preferred room type and dates to check availability.</p>

            <div className="hero-stats">
              <div className="hero-stat">
                <strong>{roomCards.length}</strong>
                <span>Room Types</span>
              </div>
              <div className="hero-stat">
                <strong>{counts.available}</strong>
                <span>Available Dates</span>
              </div>
              <div className="hero-stat">
                <strong>{selectedInfo.totalRooms}</strong>
                <span>Rooms in Type</span>
              </div>
            </div>
          </div>
        </section>

        {errorMessage && <div className="availability-error">{errorMessage}</div>}
        {warningMessage && <div className="availability-warning">{warningMessage}</div>}

        <div className="availability-layout">
          <div className="availability-left">
            <section className="card">
              <div className="section-head">
                <div>
                  <h2>Select Room Type</h2>
                  <p className="section-subtext">
                    Choose a room category before selecting your stay dates.
                  </p>
                </div>
                <div className="mini-chip">{selectedInfo.capacity}</div>
              </div>

              <div className="room-type-grid">
                {roomCards.map((room) => (
                  <button
                    key={room.dbType}
                    className={`room-type-card ${
                      selectedRoomType === room.dbType ? 'selected' : ''
                    }`}
                    onClick={() => handleRoomTypeSelect(room.dbType)}
                  >
                    <div className="room-card-top">
                      <span className="room-type-name">{room.label}</span>
                      {selectedRoomType === room.dbType && (
                        <span className="selected-pill">Selected</span>
                      )}
                    </div>

                    <span className="room-type-rate">₱{room.price}/night</span>
                    <p className="room-type-description">{room.description}</p>

                    <div className="room-features">
                      {room.features.map((feature) => (
                        <span key={feature} className="feature-pill">
                          {feature}
                        </span>
                      ))}
                    </div>

                    <div className="room-card-tag">{room.tag}</div>
                  </button>
                ))}
              </div>
            </section>

            <section className="card">
              <div className="section-head">
                <div>
                  <h2>Availability Legend</h2>
                  <p className="section-subtext">
                    Green means all rooms free, yellow means partly occupied, red means fully occupied.
                  </p>
                </div>
              </div>

              <div className="legend-list">
                <div className="legend-item">
                  <span className="legend-box available"></span>
                  <span>Available</span>
                </div>
                <div className="legend-item">
                  <span className="legend-box limited"></span>
                  <span>Limited</span>
                </div>
                <div className="legend-item">
                  <span className="legend-box booked"></span>
                  <span>Fully Booked</span>
                </div>
                <div className="legend-item">
                  <span className="legend-box selected"></span>
                  <span>Selected</span>
                </div>
              </div>
            </section>

            <section className="card calendar-card">
              <div className="calendar-header">
                <button className="month-nav-btn" onClick={handlePrevMonth}>
                  ‹
                </button>

                <div className="calendar-heading-block">
                  <h2>
                    {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
                  </h2>
                  <p>Pick your check-in and check-out dates below.</p>
                </div>

                <button className="month-nav-btn" onClick={handleNextMonth}>
                  ›
                </button>
              </div>

              {loading ? (
                <p className="calendar-loading">Loading availability...</p>
              ) : (
                <>
                  <div className="calendar-weekdays">
                    {weekDays.map((day) => (
                      <div key={day} className="weekday">
                        {day}
                      </div>
                    ))}
                  </div>

                  <div className="calendar-grid">
                    {calendarCells.map((day, index) => {
                      if (day === null) {
                        return <div key={`empty-${index}`} className="calendar-empty" />
                      }

                      const status = getStatus(day)
                      const selected = isDateSelected(day)

                      return (
                        <button
                          key={day}
                          className={`calendar-day ${status} ${selected ? 'selected' : ''}`}
                          onClick={() => handleDayClick(day)}
                          disabled={status === 'booked'}
                        >
                          <span>{day}</span>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}

              <div className="selection-actions">
                <div className="selection-info">
                  <div className="selection-box">
                    <span className="selection-label">Check-in</span>
                    <strong>{formatDate(checkIn)}</strong>
                  </div>

                  <div className="selection-box">
                    <span className="selection-label">Check-out</span>
                    <strong>{formatDate(checkOut)}</strong>
                  </div>
                </div>

                <button className="reset-btn" onClick={handleResetDates}>
                  Reset Dates
                </button>
              </div>

              <div className="calendar-summary-counts">
                <div className="count-box">
                  <span className="count-number green">{counts.available}</span>
                  <span className="count-label">Available</span>
                </div>

                <div className="count-box">
                  <span className="count-number orange">{counts.limited}</span>
                  <span className="count-label">Limited</span>
                </div>

                <div className="count-box">
                  <span className="count-number red">{counts.booked}</span>
                  <span className="count-label">Booked</span>
                </div>
              </div>
            </section>
          </div>

          <aside className="booking-summary card">
            <div className="summary-top">
              <h2>Booking Summary</h2>
              <span className="summary-badge">Updated Live</span>
            </div>

            <div className="summary-room-card">
              <div>
                <span className="summary-room-label">Selected Room</span>
                <strong>{selectedInfo.label}</strong>
              </div>
              <span className="summary-room-tag">{selectedInfo.tag}</span>
            </div>

            <div className="summary-row">
              <span>Room Type:</span>
              <strong>{selectedInfo.label}</strong>
            </div>

            <div className="summary-row">
              <span>Capacity:</span>
              <strong>{selectedInfo.capacity}</strong>
            </div>

            <div className="summary-row">
              <span>Price per night:</span>
              <strong>₱{Number(selectedInfo.price).toFixed(0)}</strong>
            </div>

            <div className="summary-row">
              <span>Selected dates:</span>
              <strong>
                {checkIn && checkOut
                  ? `${formatDate(checkIn)} - ${formatDate(checkOut)}`
                  : '-'}
              </strong>
            </div>

            <div className="summary-row">
              <span>Nights:</span>
              <strong>{nights > 0 ? nights : '-'}</strong>
            </div>

            <hr />

            <div className="summary-total">
              <span>Total:</span>
              <strong>₱{total}</strong>
            </div>

            <button
              className={`proceed-btn ${canProceed ? 'enabled' : ''}`}
              disabled={!canProceed}
              onClick={() => setShowBookingDialog(true)}
            >
              Proceed to Booking
            </button>

            <p className="proceed-note">
              {canProceed
                ? 'Dates selected and ready to continue'
                : 'Select dates to continue'}
            </p>
          </aside>
        </div>
      </main>

      {showBookingDialog && (
        <div
          onClick={() => setShowBookingDialog(false)}
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
              borderRadius: '22px',
              border: '1px solid #dce3ec',
              boxShadow: '0 24px 60px rgba(15, 23, 42, 0.22)',
              padding: '24px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                marginBottom: '18px',
              }}
            >
              <h3
                style={{
                  fontSize: '1.4rem',
                  color: '#102347',
                  margin: 0,
                  fontWeight: 700,
                }}
              >
                Confirm Booking
              </h3>

              <button
                onClick={() => setShowBookingDialog(false)}
                style={{
                  width: '38px',
                  height: '38px',
                  border: 'none',
                  borderRadius: '999px',
                  background: '#f3f4f6',
                  color: '#374151',
                  fontSize: '1.3rem',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gap: '12px',
                marginBottom: '22px',
              }}
            >
              <div style={dialogRowStyle}>
                <span>Room Type</span>
                <strong>{selectedInfo.label}</strong>
              </div>

              <div style={dialogRowStyle}>
                <span>Capacity</span>
                <strong>{selectedInfo.capacity}</strong>
              </div>

              <div style={dialogRowStyle}>
                <span>Check-in</span>
                <strong>{formatDate(checkIn)}</strong>
              </div>

              <div style={dialogRowStyle}>
                <span>Check-out</span>
                <strong>{formatDate(checkOut)}</strong>
              </div>

              <div style={dialogRowStyle}>
                <span>Nights</span>
                <strong>{nights}</strong>
              </div>

              <div style={dialogRowStyle}>
                <span>Total</span>
                <strong style={{ color: '#E87F24' }}>₱{total}</strong>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <button
                onClick={() => setShowBookingDialog(false)}
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
                Cancel
              </button>

              <button
                onClick={handleConfirmBooking}
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
                Continue to Book Now
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="site-footer">
        <div className="footer-col brand-col">
          <div className="footer-brand-logo">ALL-DAY TRAVELLERS INN</div>
          <p>Your Home Away From Home</p>
        </div>

        <div className="footer-col">
          <h3>Quick Links</h3>
          <a href="#">Home</a>
          <a href="#">Rooms &amp; Rates</a>
          <a href="#">Check Availability</a>
          <a href="#">About Us</a>
          <a href="#">Contact</a>
        </div>

        <div className="footer-col">
          <h3>Policies</h3>
          <a href="#">Terms &amp; Conditions</a>
          <a href="#">Privacy Policy</a>
          <a href="#">House Rules</a>
          <a href="#">Cancellation Policy</a>
        </div>

        <div className="footer-col">
          <h3>Contact Us</h3>
          <p>Purok 6, Brgy. Montana, Baclayon, Bohol 6301</p>
          <p>0994.977.3776</p>
          <p>dailytravellersinn@outlook.com</p>
          <div className="socials">
            <span>f</span>
            <span>◎</span>
            <span>𝕏</span>
          </div>
        </div>
      </footer>

      <div className="footer-bottom">
        © 2026 ALL-DAY TRAVELLERS INN. All rights reserved.
      </div>
    </div>
  )
}